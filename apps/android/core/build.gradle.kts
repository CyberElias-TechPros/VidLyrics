plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(17)
}

// The core module is pure JVM Kotlin: no Android classes, no reflection-based
// serialisation, no platform APIs. It can therefore be verified with kotlinc
// alone (see verify.sh) and reused by a desktop build.
tasks.register<JavaExec>("verifyCore") {
    group = "verification"
    description = "Runs the dependency-free core verification suite on the JVM"
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.vidlyrics.core.CoreSelfTestKt")
}

tasks.named("check") {
    dependsOn("verifyCore")
}
