# MediaCodec/MediaMuxer are accessed by name from our own code only; keep the
# Kotlin domain model intact for the JSON codec (no reflection, but keep names
# for readable crash reports and for exported project diagnostics).
-keep class com.vidlyrics.core.** { *; }
-keep class com.vidlyrics.studio.** { *; }
-keepattributes SourceFile,LineNumberTable
-dontwarn android.media.**
