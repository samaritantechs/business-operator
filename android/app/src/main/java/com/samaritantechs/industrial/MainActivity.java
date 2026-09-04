package com.samaritantechs.industrial;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

/**
 * A window onto the live site, and deliberately nothing more.
 *
 * Everything the shops use -- selling, stock, reports, the marketplace -- is the website. That
 * is the point: a fix or a feature is on every phone the moment it deploys, and nobody is ever
 * sent an APK for an ordinary change. This app is rebuilt only when APP_URL or the allowed
 * host list below changes.
 *
 * SamaritanApp.versionCode is what the page reads to decide whether a NEWER apk exists; the
 * site compares it against the published release and shows its own update bar. Keep the name:
 * the web side looks for exactly window.SamaritanApp.versionCode.
 */
public class MainActivity extends AppCompatActivity {

    /** The deployment this build points at. Changing it means a new versionCode and a new APK. */
    private static final String APP_URL = "https://business-operator-ivory.vercel.app/";

    /** Hosts allowed to open INSIDE the app. Anything else goes to the phone's browser, so a
     *  WhatsApp link or a bank page can never be mistaken for part of this system. */
    private static final String[] IN_APP_HOSTS = {
        "business-operator-ivory.vercel.app",
        "supabase.co",                 // product images and the APK download
        "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"
    };

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // the site remembers the session in localStorage
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "SamaritanApp");

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                for (String allowed : IN_APP_HOSTS) {
                    if (host.equals(allowed) || host.endsWith("." + allowed)) return false;
                }
                // tel:, mailto:, wa.me and everything else belongs to the phone, not to us.
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Nothing on this phone can open that link.", Toast.LENGTH_SHORT).show(); }
                return true;
            }
        });

        /* Reports download as real files, and so does the APK itself when somebody updates from
         * inside the app -- so the phone's own download manager handles them. */
        web.setDownloadListener((url, agent, disposition, mime, size) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.allowScanningByMediaScanner();
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "Downloading…", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            }
        });

        // Back goes back through the app's own history before it leaves the app.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack(); else finish();
            }
        });

        web.loadUrl(APP_URL);
    }

    /** What the website can ask about the app it is running inside. Read-only on purpose. */
    public class Bridge {
        @JavascriptInterface public int getVersionCode() { return BuildConfig.VERSION_CODE; }
        @JavascriptInterface public String getVersionName() { return BuildConfig.VERSION_NAME; }
        /* The site reads window.SamaritanApp.versionCode, so expose it as a property too --
         * addJavascriptInterface only exposes methods, hence the tiny shim injected below. */
    }

    @Override protected void onResume() {
        super.onResume();
        web.evaluateJavascript(
            "window.SamaritanApp = window.SamaritanApp || {};" +
            "try { window.SamaritanApp.versionCode = SamaritanApp.getVersionCode();" +
            "window.SamaritanApp.versionName = SamaritanApp.getVersionName(); } catch(e){}", null);
    }
}
