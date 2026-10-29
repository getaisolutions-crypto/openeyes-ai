package ai.openeyes.glasses

import ai.openeyes.glasses.core.AssistantPhase
import ai.openeyes.glasses.core.GlassesStatus
import ai.openeyes.glasses.core.Registration
import ai.openeyes.glasses.core.SessionPhase
import ai.openeyes.glasses.core.StatusText
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.types.Permission // VERIFY package in Android Studio.
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private val viewModel: MainViewModel by viewModels()

    private lateinit var connectionText: TextView
    private lateinit var cameraText: TextView
    private lateinit var sessionText: TextView
    private lateinit var answerText: TextView
    private lateinit var errorText: TextView
    private lateinit var setupNotice: TextView
    private lateinit var registerButton: Button
    private lateinit var permissionButton: Button
    private lateinit var connectButton: Button
    private lateinit var lookButton: Button
    private lateinit var askButton: Button
    private lateinit var stopButton: Button

    private val bluetoothPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.glasses.initialize() else errorText.text = getString(R.string.bluetooth_needed)
    }

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.askByVoice() else viewModel.micPermissionDenied()
    }

    // The Meta AI app shows the camera permission sheet; re-read the status from the toolkit afterwards.
    private val glassesCameraPermission = registerForActivityResult(Wearables.RequestPermissionContract()) {
        viewModel.refreshPermissions()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        bindViews()

        setupNotice.visibility = if (viewModel.backendConfigured) View.GONE else View.VISIBLE

        registerButton.setOnClickListener {
            if (viewModel.glasses.status.value.registration == Registration.REGISTERED) {
                viewModel.glasses.unregister(this)
            } else {
                viewModel.glasses.register(this)
            }
        }
        permissionButton.setOnClickListener { glassesCameraPermission.launch(Permission.CAMERA) }
        connectButton.setOnClickListener {
            val status = viewModel.glasses.status.value
            if (status.session == SessionPhase.NONE || status.session == SessionPhase.STOPPED) {
                viewModel.glasses.connect()
            } else {
                viewModel.stopEverything()
                viewModel.glasses.disconnect()
            }
        }
        lookButton.setOnClickListener { viewModel.whatAmILookingAt() }
        askButton.setOnClickListener {
            if (hasPermission(Manifest.permission.RECORD_AUDIO)) viewModel.askByVoice()
            else micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
        stopButton.setOnClickListener { viewModel.stopEverything() }

        startToolkit()
        observe()
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshPermissions()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Return trip from the Meta AI app after registration or a permission prompt.
        setIntent(intent)
        viewModel.refreshPermissions()
    }

    private fun startToolkit() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
            viewModel.glasses.initialize()
        } else {
            bluetoothPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
        }
    }

    private fun observe() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    combine(
                        viewModel.glasses.status,
                        viewModel.assistant.phase,
                        viewModel.listening,
                        viewModel.assistant.lastAnswer,
                    ) { status, phase, listening, answer -> Snapshot(status, phase, listening, answer) }
                        .collect(::render)
                }
                launch {
                    viewModel.announcements.collect { text ->
                        // TalkBack already reads the live status lines; speak only for users without it.
                        if (!isTalkBackOn()) viewModel.speakStatus(text)
                    }
                }
            }
        }
    }

    private data class Snapshot(val status: GlassesStatus, val phase: AssistantPhase, val listening: Boolean, val answer: String?)

    private fun render(s: Snapshot) {
        val status = s.status
        setIfChanged(connectionText, StatusText.connection(status))
        setIfChanged(cameraText, StatusText.camera(status))
        setIfChanged(sessionText, StatusText.session(status))
        setIfChanged(answerText, s.answer ?: getString(R.string.answer_placeholder))
        errorText.visibility = if (status.error == null) View.GONE else View.VISIBLE
        setIfChanged(errorText, status.error?.let { getString(R.string.glasses_error, it) } ?: "")

        registerButton.isEnabled = status.sdkReady
        registerButton.setText(
            if (status.registration == Registration.REGISTERED) R.string.unregister else R.string.register,
        )
        permissionButton.isEnabled = status.registration == Registration.REGISTERED

        val idle = status.session == SessionPhase.NONE || status.session == SessionPhase.STOPPED
        connectButton.isEnabled = if (idle) status.canStartSession else true
        connectButton.setText(
            when {
                status.connected -> R.string.disconnect
                idle -> R.string.connect
                else -> R.string.cancel_connect
            },
        )

        val busy = s.phase != AssistantPhase.IDLE || s.listening
        lookButton.setText(
            when (s.phase) {
                AssistantPhase.CAPTURING -> R.string.taking_photo
                AssistantPhase.ANALYZING -> R.string.thinking
                AssistantPhase.IDLE -> R.string.look
            },
        )
        askButton.setText(if (s.listening) R.string.listening else R.string.ask)
        lookButton.isEnabled = !busy
        askButton.isEnabled = !busy
        stopButton.isEnabled = true
    }

    private fun setIfChanged(view: TextView, text: String) {
        if (view.text.toString() != text) view.text = text
    }

    private fun isTalkBackOn(): Boolean =
        (getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager).isTouchExplorationEnabled

    private fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun bindViews() {
        connectionText = findViewById(R.id.connection_status)
        cameraText = findViewById(R.id.camera_status)
        sessionText = findViewById(R.id.session_status)
        answerText = findViewById(R.id.answer_text)
        errorText = findViewById(R.id.error_text)
        setupNotice = findViewById(R.id.setup_notice)
        registerButton = findViewById(R.id.register_button)
        permissionButton = findViewById(R.id.permission_button)
        connectButton = findViewById(R.id.connect_button)
        lookButton = findViewById(R.id.look_button)
        askButton = findViewById(R.id.ask_button)
        stopButton = findViewById(R.id.stop_button)
    }
}
