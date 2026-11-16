package com.samaritantechs.industrial;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
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
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

    /* WHERE THE SHOP IS. The business profile has a "Use my current location" button, so a
     * shopkeeper standing at the counter can put the shop on the map for customers without
     * knowing what a coordinate is. A WebView answers every such request with "no" unless the
     * app says otherwise -- silently, so in the app the button did nothing a person could see.
     *
     * Two things are held until Android has asked the person: which page asked, and the
     * callback the WebView is waiting on. As with the photo picker, that callback MUST be
     * answered exactly once, yes or no, or the page waits for ever. */
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeo;

    private final ActivityResultLauncher<String[]> askLocation = registerForActivityResult(
        new ActivityResultContracts.RequestMultiplePermissions(), granted -> {
            boolean ok = false;
            for (Boolean g : granted.values()) if (Boolean.TRUE.equals(g)) ok = true;   // fine OR approximate will do
            answerLocation(ok);
        });

    private void answerLocation(boolean ok) {
        GeolocationPermissions.Callback cb = pendingGeo;
        String origin = pendingGeoOrigin;
        pendingGeo = null;
        pendingGeoOrigin = null;
        // retain=false: decided afresh each time, so a "no" today is not a "no" for ever.
        if (cb != null) cb.invoke(origin, ok, false);
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Only this system's own pages may learn where the phone is -- never a page it merely shows. */
    private static boolean isOurOrigin(String origin) {
        if (origin == null) return false;
        Uri o = Uri.parse(origin);
        return "https".equals(o.getScheme()) && Uri.parse(APP_URL).getHost().equals(o.getHost());
    }

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
        s.setGeolocationEnabled(true);         // and onGeolocationPermissionsShowPrompt below decides who may use it
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

            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (!isOurOrigin(origin)) { cb.invoke(origin, false, false); return; }
                if (hasLocationPermission()) { cb.invoke(origin, true, false); return; }
                answerLocation(false);                 // a stale question is answered before a new one is asked
                pendingGeoOrigin = origin;
                pendingGeo = cb;
                try {
                    askLocation.launch(new String[] {
                        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION });
                } catch (Exception e) {
                    answerLocation(false);             // answered, not abandoned: the page then says how to do it by hand
                }
            }

            @Override public void onGeolocationPermissionsHidePrompt() {
                // The page withdrew the question. There is nobody left to answer, so it is
                // forgotten rather than answered; a late reply from Android then finds nothing.
                pendingGeo = null;
                pendingGeoOrigin = null;
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
        web.setDownloadListener((url, agent, disposition, mime, size) -> saveFile(url, nameFrom(url, disposition, mime)));

        // Back goes back through the app's own history before it leaves the app.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack(); else finish();
            }
        });

        /* STARTED, OR BROUGHT BACK? The site opens on the marketplace when the app is started,
         * and goes back to the screen the person was on when it is only being restored. Android
         * says which: saved state exists only when IT put the app away -- cleared from memory
         * while still in the recent-apps list -- and never after the person swiped it off that
         * list or backed out of it. The page cannot tell these apart by itself (a rebuilt
         * WebView remembers nothing of its session), so it is told, in the address. */
        web.loadUrl(state != null ? APP_URL + "?resume=1" : APP_URL);
    }

    /* ONE WAY OF SAVING A FILE, whoever asked for it: a link that turned out to be a download
     * (the WebView tells us, above) or the page itself (SamaritanApp.download, below).
     *
     * The download manager fetches ADDRESSES. A picture or file that exists only inside the
     * page (data:, blob:) has none, and asking for it threw -- into a fallback that threw
     * again, with nothing to catch it. Such a file is refused in words; the site serves its
     * own downloads as ordinary https files for exactly this reason.
     *
     * A report, a picture or a sheet goes to the phone's own Downloads folder under its real
     * name: that is where the Files app shows it, and nothing clears it away. The download
     * manager's own store -- where everything used to go -- is hidden from the Files app on
     * Android 10 and later and may be emptied by the phone at any time.
     *
     * THE APK IS THE EXCEPTION, ON PURPOSE. Updating the app is the one download that must
     * never break, and it has always worked from that store; it is left exactly as it was. */
    private void saveFile(String url, String name) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            Toast.makeText(this, "This file cannot be saved from inside the app.", Toast.LENGTH_SHORT).show();
            return;
        }
        String file = cleanName(name);
        boolean keep = !file.isEmpty() && !file.toLowerCase(Locale.US).endsWith(".apk");
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            try {
                dm.enqueue(downloadOf(url, file, keep));
            } catch (Exception noSharedFolder) {
                // Android 9 and older want a storage permission for the shared folder, and a
                // phone may have no such folder at all: the manager's own store still works.
                if (!keep) throw noSharedFolder;
                dm.enqueue(downloadOf(url, file, false));
            }
            Toast.makeText(this, "Downloading…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
            catch (Exception e2) { Toast.makeText(this, "Nothing on this phone can download that.", Toast.LENGTH_SHORT).show(); }
        }
    }

    private DownloadManager.Request downloadOf(String url, String file, boolean toDownloads) {
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.allowScanningByMediaScanner();
        if (toDownloads) {
            req.setTitle(file);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, file);
        }
        return req;
    }

    /** What the server called the file. URLUtil only reads "attachment; filename=", and a PDF
     *  is served "inline; filename=" -- so the name is read here first, and URLUtil's guess
     *  (from the address and the type) is what is left when there is none. */
    private static String nameFrom(String url, String disposition, String mime) {
        if (disposition != null) {
            Matcher m = Pattern.compile("(?i)filename\\s*=\\s*\"?([^\";]+)\"?").matcher(disposition);
            if (m.find()) return m.group(1).trim();
        }
        try { return URLUtil.guessFileName(url, disposition, mime); } catch (Exception e) { return ""; }
    }

    /** A file name and nothing else: no folders, nothing a file system chokes on. */
    private static String cleanName(String name) {
        if (name == null) return "";
        String n = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        return n.length() > 120 ? n.substring(n.length() - 120) : n;
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

        /** "Open in the phone's browser" -- the one thing the page cannot do for itself, because
         *  this system's own address is exactly what shouldOverrideUrlLoading keeps inside the
         *  app. A web address only: this is a door to a browser, not to any app on the phone. */
        /** A file of this system's own, saved without the WebView having to ask for it first:
         *  one request instead of two (a report is not built twice), and a refusal is a failed
         *  download in the phone's own list rather than a page of raw text where the app was.
         *  Only this deployment's own https addresses -- it is not a downloader for the web. */
        @JavascriptInterface public void download(final String url, final String name) {
            runOnUiThread(() -> {
                if (!isOurOrigin(url)) {
                    Toast.makeText(MainActivity.this, "This file cannot be saved from inside the app.", Toast.LENGTH_SHORT).show();
                    return;
                }
                saveFile(url, name);
            });
        }

        /** The page on paper, or as a PDF: the phone's own print screen, fed by this WebView.
         *  window.print() does nothing in a WebView, so the page asks for this instead and
         *  sets its own print styling (a receipt prints as a receipt, not as the whole app). */
        @JavascriptInterface public void print(final String title) {
            runOnUiThread(() -> {
                try {
                    String job = (title == null || title.trim().isEmpty()) ? "Samaritan Industrial" : title.trim();
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    pm.print(job, web.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "This phone could not open its print screen.", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface public void openExternal(final String url) {
            runOnUiThread(() -> {
                try {
                    Uri u = Uri.parse(url == null ? "" : url);
                    String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
                    if (!scheme.equals("https") && !scheme.equals("http")) return;
                    Intent i = new Intent(Intent.ACTION_VIEW, u);
                    i.addCategory(Intent.CATEGORY_BROWSABLE);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No browser on this phone could open that.", Toast.LENGTH_SHORT).show();
                }
            });
        }
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
