# 肘边备急 —— 本工程仅有 WebView 外壳，无需额外混淆规则
# 保留 WebView 相关回调（若后续接入 JS 桥）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
