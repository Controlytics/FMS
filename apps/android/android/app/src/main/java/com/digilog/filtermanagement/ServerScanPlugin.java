package com.digilog.filtermanagement;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * ServerScanPlugin — finds hosts with the DigiLog API port open on the local
 * network, so the tablet can rediscover the server after its DHCP address
 * changes (tasks/AUTO-IP-RECOVERY-PLAN.md, Part 2).
 *
 * Why native: a /24 sweep from the WebView is up to 254 HTTPS fetches to dead
 * addresses, and aborted fetches do not reliably release their sockets — the
 * same pile-up that OOM-crashed the WebView on 2026-07-03. Here it is a plain
 * TCP connect with a short timeout on a bounded thread pool. This plugin does
 * NOT decide which host is the server: JS checks each open host's /api/health
 * over HTTPS (certificate trust + serverId).
 *
 * JS:
 *   const Scan = registerPlugin('ServerScan');
 *   const { open, localIp } = await Scan.scan({ port: 3000, prefixes: ['192.168.1'] });
 *
 * The tablet's own /24 (from the active network) is always added to `prefixes`.
 */
@CapacitorPlugin(name = "ServerScan")
public class ServerScanPlugin extends Plugin {

    @PluginMethod
    public void scan(final PluginCall call) {
        final int port = call.getInt("port", 3000);
        final int timeoutMs = Math.max(100, Math.min(call.getInt("timeoutMs", 300), 2000));
        final int threads = Math.max(1, Math.min(call.getInt("threads", 32), 64));

        final Set<String> prefixes = new LinkedHashSet<>();
        final String localIp = localIpv4();
        if (localIp != null) prefixes.add(prefixOf(localIp));
        JSArray given = call.getArray("prefixes");
        if (given != null) {
            for (int i = 0; i < given.length(); i++) {
                String p = given.optString(i, "");
                if (p.matches("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$")) prefixes.add(p);
            }
        }

        new Thread(() -> {
            final List<String> open = Collections.synchronizedList(new ArrayList<>());
            ExecutorService pool = Executors.newFixedThreadPool(threads);
            for (String prefix : prefixes) {
                for (int h = 1; h <= 254; h++) {
                    final String host = prefix + "." + h;
                    if (host.equals(localIp)) continue;
                    pool.execute(() -> {
                        try (Socket s = new Socket()) {
                            s.connect(new InetSocketAddress(host, port), timeoutMs);
                            open.add(host);
                        } catch (Exception ignored) {
                            // Closed / filtered / no host: exactly what a sweep expects
                            // for almost every address. Not an error.
                        }
                    });
                }
            }
            pool.shutdown();
            try {
                pool.awaitTermination(60, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                pool.shutdownNow();
                Thread.currentThread().interrupt();
            }
            JSObject ret = new JSObject();
            ret.put("open", new JSONArray(open));
            ret.put("localIp", localIp);
            ret.put("prefixes", new JSONArray(new ArrayList<>(prefixes)));
            call.resolve(ret);
        }, "ServerScan").start();
    }

    private String localIpv4() {
        ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return null;
        Network net = cm.getActiveNetwork();
        if (net == null) return null;
        LinkProperties lp = cm.getLinkProperties(net);
        if (lp == null) return null;
        for (LinkAddress la : lp.getLinkAddresses()) {
            if (la.getAddress() instanceof Inet4Address && !la.getAddress().isLoopbackAddress()) {
                return la.getAddress().getHostAddress();
            }
        }
        return null;
    }

    private static String prefixOf(String ip) {
        return ip.substring(0, ip.lastIndexOf('.'));
    }
}
