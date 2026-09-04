import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { SettingsService } from "@/lib/data/settings-service";
import type { AppSettings } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";

const orgSchema = z.object({
  organisationName: z.string().min(1, "Required"),
  timezone: z.string().min(1, "Required"),
  baseCurrency: z.string().min(1, "Required"),
  standardDailyHours: z.coerce.number().min(1).max(24),
  standardWeeklyHours: z.coerce.number().min(1).max(168),
  probationDurationMonths: z.coerce.number().int().min(0).max(36),
  leaveYearStart: z.string().min(1, "Format MM-DD"),
  leaveYearEnd: z.string().min(1, "Format MM-DD"),
});

const numberingSchema = z.object({
  employeeNumberFormat: z.string().min(1, "Required"),
  candidateReferenceFormat: z.string().min(1, "Required"),
});

export function OrganisationSettingsPanel() {
  const { getActorContext } = useCurrentUser();
  const [settingsService] = useState(() => new SettingsService());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [workingDays, setWorkingDays] = useState<number[]>([]);
  const [reminderDays, setReminderDays] = useState("");

  const form = useForm<z.infer<typeof orgSchema>>({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      organisationName: "",
      timezone: "",
      baseCurrency: "",
      standardDailyHours: 8,
      standardWeeklyHours: 40,
      probationDurationMonths: 3,
      leaveYearStart: "",
      leaveYearEnd: "",
    },
  });

  useEffect(() => {
    settingsService
      .getAppSettings()
      .then((data) => {
        setSettings(data);
        form.reset(data);
        setWorkingDays(data.workingDays);
        setReminderDays(data.documentReminderDays.join(", "));
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load settings");
      });
  }, [settingsService, form]);

  const onSubmit = async (values: z.infer<typeof orgSchema>) => {
    if (!settings) return;
    try {
      const parsedReminderDays = reminderDays
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));
      const updated = await settingsService.saveAppSettings(
        {
          ...settings,
          ...values,
          baseCurrency: values.baseCurrency.toUpperCase(),
          workingDays,
          documentReminderDays: parsedReminderDays,
        },
        getActorContext(),
      );
      toast.success("Organisation settings updated");
      setSettings(updated);
      form.reset(updated);
      setWorkingDays(updated.workingDays);
      setReminderDays(updated.documentReminderDays.join(", "));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  if (!settings) {
    return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
          <CardDescription>
            Company settings used for leave, timesheets and reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="organisationName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organisation Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Asia/Muscat" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="baseCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Base Currency</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="OMR" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="standardDailyHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Standard Daily Hours</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="standardWeeklyHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Standard Weekly Hours</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="probationDurationMonths"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Standard Probation (Months)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={36} {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        This controls employment probation only. Leave waiting periods are managed
                        separately in Leave Policies.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="leaveYearStart"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Leave Year Start (MM-DD)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="01-01" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="leaveYearEnd"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Leave Year End (MM-DD)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="12-31" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="space-y-3 rounded-md border p-4">
                <div>
                  <Label>Company Working Days</Label>
                  <p className="text-sm text-muted-foreground">
                    Used when calculating leave, timesheets and attendance expectations.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((label, day) => (
                    <label
                      key={label}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      {label}
                      <Switch
                        aria-label={`${label} is a working day`}
                        checked={workingDays.includes(day)}
                        onCheckedChange={(checked) =>
                          setWorkingDays((current) =>
                            checked
                              ? [...current, day].sort((a, b) => a - b)
                              : current.filter((item) => item !== day),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-reminders">Document Expiry Reminders</Label>
                <Input
                  id="document-reminders"
                  value={reminderDays}
                  onChange={(event) => setReminderDays(event.target.value)}
                  placeholder="90, 60, 30, 14, 7"
                />
                <p className="text-xs text-muted-foreground">
                  Enter the days before expiry when reminders should be sent, separated by commas.
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit">Save Organisation Settings</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employee Setup Access</CardTitle>
          <CardDescription>
            Employees retain access to essential work services while completing their record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Progressive access is enabled</Label>
              <p className="text-sm text-muted-foreground max-w-xl">
                Staff can use attendance, timesheets, tasks, notifications and their profile while
                completing setup. Leave and other policy-dependent requests wait until HR confirms
                employment information. Missing documents remain visible as required actions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function NumberingSettingsPanel() {
  const { getActorContext } = useCurrentUser();
  const [settingsService] = useState(() => new SettingsService());
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const form = useForm<z.infer<typeof numberingSchema>>({
    resolver: zodResolver(numberingSchema),
    defaultValues: {
      employeeNumberFormat: "",
      candidateReferenceFormat: "",
    },
  });

  useEffect(() => {
    settingsService
      .getAppSettings()
      .then((data) => {
        setSettings(data);
        form.reset({
          employeeNumberFormat: data.employeeNumberFormat,
          candidateReferenceFormat: data.candidateReferenceFormat,
        });
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load settings");
      });
  }, [settingsService, form]);

  const onSubmit = async (values: z.infer<typeof numberingSchema>) => {
    if (!settings) return;
    try {
      const updated = await settingsService.saveAppSettings(
        { ...settings, ...values },
        getActorContext(),
      );
      toast.success("Numbering formats updated");
      setSettings(updated);
      form.reset(updated);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  if (!settings) {
    return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Numbering Sequences</CardTitle>
        <CardDescription>
          Use <code>{"{0000}"}</code> as a placeholder for the incrementing sequence number.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="employeeNumberFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee Number Format</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="VIA-{0000}" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="candidateReferenceFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Candidate Reference Format</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="CAND-{00000}" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Save Numbering Formats</Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
