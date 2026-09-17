package com.samaritantechs.industrial;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import java.io.File;

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

    /* THE PHOTO PICKER. A WebView with no WebChromeClient does not merely ignore
     * <input type="file"> -- it never asks anybody anything, so tapping a photo slot on the
     * Products screen did nothing at all. The same missing client is why window.confirm()
     * returned false and window.alert() was a no-op: setting ANY chrome client restores the
     * WebView's own dialogs, which is half of what this class now exists for.
     *
     * (The website no longer depends on those dialogs -- it asks in its own page, so the fix
     * reached every phone the day it deployed rather than waiting for this APK. A file picker
     * has no such workaround: only the app can open one.) */
    private ValueCallback<Uri[]> pendingFiles;
    private Uri cameraShot;

    /* Registered as a field, which is where the ActivityResult API requires it: by the time
     * onCreate has run it is too late to register one. */
    private final ActivityResultLauncher<Intent> chooser = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            if (pendingFiles == null) return;
            Uri[] out = null;
            if (result.getResultCode() == RESULT_OK) {
                Intent data = result.getData();
                /* THE CAMERA ANSWERS WITH NOTHING. It wrote the picture into the file we handed
                 * it, so an empty result with a shot pending means "it is in there" -- reading
                 * only data.getData() would throw the photo away and look like a cancel. */
                if (data == null || (data.getData() == null && data.getClipData() == null)) {
                    if (cameraShot != null) out = new Uri[] { cameraShot };
                } else {
                    out = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data);
                }
            }
            /* NULL IS NOT OPTIONAL ON A CANCEL. A ValueCallback that is never called leaves the
             * WebView believing a chooser is still open, and every later tap on any file input
             * is ignored for the life of the app. */
            pendingFiles.onReceiveValue(out);
            pendingFiles = null;
            cameraShot = null;
        });

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

        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);   // a stale one would wedge the next
                pendingFiles = cb;
                cameraShot = null;
                try {
                    chooser.launch(chooserFor(params));
                    return true;
                } catch (Exception e) {
                    pendingFiles = null;
                    cameraShot = null;
                    Toast.makeText(MainActivity.this, "This phone has nothing that can choose a picture.", Toast.LENGTH_SHORT).show();
                    return false;   // false, not an unanswered callback: the WebView must be let go
                }
            }
        });

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

    /** The gallery, plus the camera alongside it. A shop registering a product has the thing in
     *  its hand and a phone that can photograph it, so "take one now" has to be on the sheet --
     *  the plain picker offers only pictures that already exist. */
    private Intent chooserFor(WebChromeClient.FileChooserParams params) {
        Intent sheet = Intent.createChooser(params.createIntent(), "Choose a picture");
        Intent cam = cameraIntent();
        if (cam != null) sheet.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { cam });
        return sheet;
    }

    /** The camera half, or null if this phone has no camera app or the temp file cannot be made.
     *  Null is a normal answer, not a failure: the gallery picker still opens without it. */
    private Intent cameraIntent() {
        try {
            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (cam.resolveActivity(getPackageManager()) == null) return null;
            File dir = new File(getCacheDir(), "shots");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File f = File.createTempFile("shot", ".jpg", dir);
            /* A file:// Uri would crash the camera app on Android 7 and later (FileUriExposed),
             * so it goes out through the FileProvider declared in the manifest. */
            Uri u = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            cam.putExtra(MediaStore.EXTRA_OUTPUT, u);
            cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            cameraShot = u;
            return cam;
        } catch (Exception e) {
            return null;
        }
    }

    /** What the website can ask about the app it is running inside. Read-only on purpose. */
    public class Bridge {
        @JavascriptInterface public int getVersionCode() { return BuildConfig.VERSION_CODE; }
        @JavascriptInterface public String getVersionName() { return BuildConfig.VERSION_NAME; }
        /* The site reads window.SamaritanApp.versionCode, so expose it as a property too --
         * addJavascriptInterface only exposes methods, hence the tiny shim injected below. */
    }

    /* COMING BACK TO THE APP IS AN "OPEN" to the person holding it, but the WebView is not
     * reloaded when that happens: the page's own boot code ran days ago and will not run again.
     * So the version is re-published here -- and the site is asked to re-check whether this APK
     * is still the current one, which is the only moment an already-installed old build can
     * learn that it is old. BO.recheckUpdate throttles itself to one read every six hours, so
     * switching apps forty times a day is not forty reads; it is guarded because an older page,
     * or a page that has not finished loading, will not have it. */
    @Override protected void onResume() {
        super.onResume();
        web.evaluateJavascript(
            "window.SamaritanApp = window.SamaritanApp || {};" +
            "try { window.SamaritanApp.versionCode = SamaritanApp.getVersionCode();" +
            "window.SamaritanApp.versionName = SamaritanApp.getVersionName(); } catch(e){}" +
            "try { if (window.BO && BO.recheckUpdate) BO.recheckUpdate(); } catch(e){}", null);
    }
}
