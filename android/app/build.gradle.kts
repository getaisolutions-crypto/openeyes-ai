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

        buildConfigField("String", "OPENEYES_FUNCTION_URL", "\"${localProp("openeyes.functionUrl", "")}\"")
        buildConfigField("String", "OPENEYES_PUBLIC_KEY", "\"${localProp("openeyes.publicKey", "")}\"")
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
