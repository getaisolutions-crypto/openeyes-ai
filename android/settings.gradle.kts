pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // The Meta Wearables Device Access Toolkit is published to Maven Central (group com.meta.wearable).
        mavenCentral()
    }
}

rootProject.name = "OpenEyesGlasses"
include(":app")
