import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

val localProps = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun localProp(key: String, fallback: String): String = localProps.getProperty(key) ?: fallback

// The website's own settings (repository root .env), so the APK calls the same openeyes-ai server function.
val websiteEnv: Map<String, String> = rootProject.file("../.env").let { file ->
    if (!file.exists()) emptyMap()
    else file.readLines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .associate { line -> line.substringBefore("=").trim() to line.substringAfter("=").trim().trim('"', '\'') }
}

fun firstReal(vararg candidates: String?): String =
    candidates.firstOrNull { !it.isNullOrBlank() && !it.contains("YOUR", ignoreCase = false) }?.trim() ?: ""

val supabaseUrl = firstReal(
    localProps.getProperty("openeyes.supabaseUrl"),
    System.getenv("VITE_SUPABASE_URL"),
    websiteEnv["VITE_SUPABASE_URL"],
).trimEnd('/')

val openEyesFunctionUrl = firstReal(
    localProps.getProperty("openeyes.functionUrl"),
    supabaseUrl.takeIf { it.isNotEmpty() }?.let { "$it/functions/v1/openeyes-ai" },
)

// Public (anon) key, the same one the website ships to every browser. Not a secret; the Meta key stays on the server.
val openEyesPublicKey = firstReal(
    localProps.getProperty("openeyes.publicKey"),
    System.getenv("VITE_SUPABASE_ANON_KEY"),
    websiteEnv["VITE_SUPABASE_ANON_KEY"],
)

val openEyesConfigProblem: String? = when {
    openEyesFunctionUrl.isEmpty() ->
        "OpenEyes server address not found. Set openeyes.functionUrl in android/local.properties (see local.properties.example)."
    !openEyesFunctionUrl.startsWith("https://") -> "openeyes.functionUrl must start with https://"
    openEyesPublicKey.isEmpty() ->
        "OpenEyes public key not found. Set openeyes.publicKey in android/local.properties (see local.properties.example)."
    else -> null
}

android {
    namespace = "ai.openeyes.glasses"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.openeyes.glasses"
        // The Device Access Toolkit supports Android 10 (API 29) and newer.
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.6.0"

        // Developer Mode in the Meta AI app accepts 0 for both values; production needs Wearables Developer Center values.
        manifestPlaceholders["mwdat_application_id"] = localProp("mwdat.applicationId", "0")
        manifestPlaceholders["mwdat_client_token"] = localProp("mwdat.clientToken", "0")

        buildConfigField("String", "OPENEYES_FUNCTION_URL", "\"$openEyesFunctionUrl\"")
        buildConfigField("String", "OPENEYES_PUBLIC_KEY", "\"$openEyesPublicKey\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.mwdat.core)
    implementation(libs.mwdat.camera)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.lifecycle.viewmodel)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.org.json)
}

// Refuse to produce an APK that cannot reach the server (unit tests still run without it).
tasks.matching { it.name.matches(Regex("(assemble|install|bundle)(Debug|Release)?")) }
    .configureEach {
        doFirst {
            openEyesConfigProblem?.let { throw GradleException(it) }
        }
    }
