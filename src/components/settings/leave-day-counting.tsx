import { useEffect, useState } from "react";
import { SettingsService } from "@/lib/data/settings-service";
import { useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { leaveYearForDate } from "@/lib/data/leave-year";
import { toast } from "sonner";

export function LeaveDayCounting() {
  const { getActorContext } = useCurrentUser();
  const [service] = useState(() => new SettingsService());
  const [saved, setSaved] = useState<boolean | null>(null);
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [carryYear, setCarryYear] = useState(2025);
  const [carryExpiry, setCarryExpiry] = useState("");
  const [futureCarryExpiry, setFutureCarryExpiry] = useState("");
  const [savedCarryExpiry, setSavedCarryExpiry] = useState("");
  const [savedFutureCarryExpiry, setSavedFutureCarryExpiry] = useState("");
  const setCarrySettings = (settings: Awaited<ReturnType<SettingsService["getAppSettings"]>>) => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const previousYear = leaveYearForDate(today, settings.leaveYearStart) - 1;
    const expiry = settings.annualCarryExpiryDates?.[String(previousYear)] ?? "";
    const futureExpiry = settings.annualCarryExpiryMonthDay ?? "";
    setCarryYear(previousYear);
    setCarryExpiry(expiry);
    setFutureCarryExpiry(futureExpiry);
    setSavedCarryExpiry(expiry);
    setSavedFutureCarryExpiry(futureExpiry);
  };
  const load = () => {
    setFailed(false);
    void service
      .getAppSettings()
      .then((settings) => {
        setSaved(settings.leaveIncludesWeekends !== false);
        setInclude(settings.leaveIncludesWeekends !== false);
        setCarrySettings(settings);
      })
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    let active = true;
    void service
      .getAppSettings()
      .then((settings) => {
        if (!active) return;
        setSaved(settings.leaveIncludesWeekends !== false);
        setInclude(settings.leaveIncludesWeekends !== false);
        setCarrySettings(settings);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [service]);
  const save = async () => {
    setBusy(true);
    try {
      const current = await service.getAppSettings();
      if (current.leaveIncludesWeekends !== include) {
        await service.saveAppSettings(
          { ...current, leaveIncludesWeekends: include },
          getActorContext(),
        );
      }
      setSaved(include);
      toast.success("Leave day counting updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save leave settings");
    } finally {
      setBusy(false);
    }
  };
  const saveCarry = async () => {
    setBusy(true);
    try {
      const current = await service.getAppSettings();
      await service.saveAppSettings(
        {
          ...current,
          annualCarryExpiryDates: {
            ...(current.annualCarryExpiryDates ?? {}),
            [String(carryYear)]: carryExpiry || null,
          },
          annualCarryExpiryMonthDay: futureCarryExpiry || null,
        },
        getActorContext(),
      );
      setSavedCarryExpiry(carryExpiry);
      setSavedFutureCarryExpiry(futureCarryExpiry);
      toast.success("Annual leave carry dates updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save carry dates");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Counting leave days</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed ? (
          <Button variant="outline" onClick={load}>
            Retry loading leave settings
          </Button>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="leave-weekends">Include weekends</Label>
              <Switch
                id="leave-weekends"
                checked={include}
                disabled={saved === null || busy}
                onCheckedChange={setInclude}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {include
                ? "Weekends count towards leave."
                : "Only the company's working days count towards leave."}{" "}
              Public holidays are excluded.
            </p>
            <p className="text-xs text-muted-foreground">
              Applies to all leave types for new requests and date amendments. Existing recorded
              totals stay unchanged.
            </p>
            <Button onClick={save} disabled={saved === null || saved === include || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <div className="space-y-3 border-t pt-5">
              <h3 className="font-semibold">Unused annual leave</h3>
              <p className="text-sm text-muted-foreground">
                Carried days are shown separately. New leave uses the older days first.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="carry-expiry">{carryYear} days expire after</Label>
                  <Input
                    id="carry-expiry"
                    type="date"
                    value={carryExpiry}
                    disabled={busy || saved === null}
                    onChange={(event) => setCarryExpiry(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank until HR confirms the date.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="future-carry-expiry">Future rollover expiry (MM-DD)</Label>
                  <Input
                    id="future-carry-expiry"
                    placeholder="For example, 05-31"
                    value={futureCarryExpiry}
                    disabled={busy || saved === null}
                    onChange={(event) => setFutureCarryExpiry(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Applies each year unless that year has its own date.
                  </p>
                </div>
              </div>
              <Button
                onClick={saveCarry}
                disabled={
                  busy ||
                  saved === null ||
                  (savedCarryExpiry === carryExpiry && savedFutureCarryExpiry === futureCarryExpiry)
                }
              >
                Save carry dates
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
