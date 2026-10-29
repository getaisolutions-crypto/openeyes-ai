package ai.openeyes.glasses

import ai.openeyes.glasses.ui.AskScreen
import ai.openeyes.glasses.ui.ExploreScreen
import ai.openeyes.glasses.ui.FindScreen
import ai.openeyes.glasses.ui.HomeScreen
import ai.openeyes.glasses.ui.ReadScreen
import ai.openeyes.glasses.ui.ScreenHost
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.types.Permission // VERIFY package in Android Studio.
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity(), ScreenHost {

    private val viewModel: MainViewModel by viewModels()

    private lateinit var screens: Map<Screen, View>
    private lateinit var home: HomeScreen
    private lateinit var explore: ExploreScreen
    private lateinit var find: FindScreen
    private lateinit var read: ReadScreen
    private lateinit var ask: AskScreen

    private var afterMicPermission: (() -> Unit)? = null

    private val bluetoothPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            viewModel.glasses.initialize()
        } else {
            findViewById<TextView>(R.id.error_text).apply {
                visibility = View.VISIBLE
                text = getString(R.string.bluetooth_needed)
            }
        }
    }

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val action = afterMicPermission
        afterMicPermission = null
        if (granted) action?.invoke() else viewModel.micPermissionDenied()
    }

    // The Meta AI app shows the camera permission sheet; re-read the status from the toolkit afterwards.
    private val glassesCameraPermission = registerForActivityResult(Wearables.RequestPermissionContract()) {
        viewModel.refreshPermissions()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        screens = mapOf(
            Screen.HOME to findViewById(R.id.screen_home),
            Screen.EXPLORE to findViewById(R.id.screen_explore),
            Screen.FIND to findViewById(R.id.screen_find),
            Screen.READ to findViewById(R.id.screen_read),
            Screen.ASK to findViewById(R.id.screen_ask),
        )
        home = HomeScreen(screens.getValue(Screen.HOME), this, viewModel, this) {
            glassesCameraPermission.launch(Permission.CAMERA)
        }
        explore = ExploreScreen(screens.getValue(Screen.EXPLORE), viewModel, this)
        find = FindScreen(screens.getValue(Screen.FIND), viewModel, this)
        read = ReadScreen(screens.getValue(Screen.READ), viewModel, this)
        ask = AskScreen(screens.getValue(Screen.ASK), viewModel, this)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!viewModel.back()) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        })

        startToolkit()
        observe()
    }

    override fun onResume() {
        super.onResume()
        viewModel.refreshPermissions()
    }

    override fun onStop() {
        super.onStop()
        // Rotation also stops the activity; only a real trip to the background turns the camera off.
        if (!isChangingConfigurations) viewModel.onBackground()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Return trip from the Meta AI app after registration or a permission prompt.
        setIntent(intent)
        viewModel.refreshPermissions()
    }

    override fun withMicrophone(action: () -> Unit) {
        if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
            action()
        } else {
            afterMicPermission = action
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
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
                home.observe(this)
                explore.observe(this)
                find.observe(this)
                read.observe(this)
                ask.observe(this)
                launch { viewModel.screen.collect(::show) }
                launch {
                    viewModel.announcements.collect { text ->
                        // TalkBack already reads the live status lines; speak only for users without it.
                        if (!isTalkBackOn()) viewModel.speakStatus(text)
                    }
                }
            }
        }
    }

    private fun show(screen: Screen) {
        screens.forEach { (key, view) -> view.visibility = if (key == screen) View.VISIBLE else View.GONE }
        val visible = screens.getValue(screen)
        title = getString(
            when (screen) {
                Screen.HOME -> R.string.title
                Screen.EXPLORE -> R.string.explore_title
                Screen.FIND -> R.string.find_title
                Screen.READ -> R.string.read_title
                Screen.ASK -> R.string.ask_title
            },
        )
        visible.announceForAccessibility(title)
    }

    private fun isTalkBackOn(): Boolean =
        (getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager).isTouchExplorationEnabled

    private fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}
