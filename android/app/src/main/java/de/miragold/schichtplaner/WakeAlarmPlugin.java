package de.miragold.schichtplaner;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Schnittstelle für app.js: Wecktöne planen (schedule) und testen (test). */
@CapacitorPlugin(name = "WakeAlarm")
public class WakeAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray alarms = call.getArray("alarms", new JSArray());
        String sound = call.getString("sound", "app");
        try {
            WakeAlarmScheduler.replaceAll(getContext(), alarms.toString(), sound);
            call.resolve();
        } catch (Exception e) {
            call.reject("Wecktöne konnten nicht geplant werden: " + e.getMessage());
        }
    }

    @PluginMethod
    public void test(PluginCall call) {
        try {
            long at = Long.parseLong(call.getString("at"));
            WakeAlarmScheduler.set(getContext(), WakeAlarmScheduler.TEST_ID, at,
                    call.getString("title", "Schichtplaner – Test"), call.getString("body", ""), call.getString("sound", "app"));
            call.resolve();
        } catch (Exception e) {
            call.reject("Test-Weckton konnte nicht geplant werden: " + e.getMessage());
        }
    }
}
