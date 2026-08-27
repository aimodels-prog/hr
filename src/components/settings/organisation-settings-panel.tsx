import { useMemo, useState } from "react";
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
import { useCurrentUser } from "@/lib/auth";

const orgSchema = z.object({
  organisationName: z.string().min(1, "Required"),
  timezone: z.string().min(1, "Required"),
  baseCurrency: z.string().min(1, "Required"),
  standardDailyHours: z.coerce.number().min(1).max(24),
  standardWeeklyHours: z.coerce.number().min(1).max(168),
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
  const [refreshKey, setRefreshKey] = useState(0);
  const settings = useMemo(() => settingsService.getAppSettings(), [settingsService, refreshKey]);

  const form = useForm<z.infer<typeof orgSchema>>({
    resolver: zodResolver(orgSchema),
    defaultValues: {
      organisationName: settings.organisationName,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
      standardDailyHours: settings.standardDailyHours,
      standardWeeklyHours: settings.standardWeeklyHours,
      leaveYearStart: settings.leaveYearStart,
      leaveYearEnd: settings.leaveYearEnd,
    },
  });

  const onSubmit = (values: z.infer<typeof orgSchema>) => {
    try {
      settingsService.saveAppSettings({ ...settings, ...values }, getActorContext());
      toast.success("Organisation settings updated");
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      toast.error(e.message || "Failed to save settings");
    }
  };

  const toggleOnboardingGate = (checked: boolean) => {
    try {
      settingsService.saveAppSettings(
        { ...settings, requireOnboardingCompletionBeforeDashboard: checked },
        getActorContext(),
      );
      toast.success(
        checked
          ? "New hires will be gated until onboarding is complete"
          : "Onboarding gate disabled",
      );
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      toast.error(e.message || "Failed to save settings");
    }
  };

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
              <div className="flex justify-end">
                <Button type="submit">Save Organisation Settings</Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New Hire Onboarding Policy</CardTitle>
          <CardDescription>
            Controls what a new employee sees the first time they sign in with their work email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                Require onboarding details before dashboard access
              </Label>
              <p className="text-sm text-muted-foreground max-w-xl">
                When on, a new hire who has not finished onboarding will see the onboarding form
                first. They can use the rest of VIA HR System after completing their personal, bank,
                contract and ID information for HR and Finance.
              </p>
            </div>
            <Switch
              checked={settings.requireOnboardingCompletionBeforeDashboard}
              onCheckedChange={toggleOnboardingGate}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function NumberingSettingsPanel() {
  const { getActorContext } = useCurrentUser();
  const [settingsService] = useState(() => new SettingsService());
  const [refreshKey, setRefreshKey] = useState(0);
  const settings = useMemo(() => settingsService.getAppSettings(), [settingsService, refreshKey]);

  const form = useForm<z.infer<typeof numberingSchema>>({
    resolver: zodResolver(numberingSchema),
    defaultValues: {
      employeeNumberFormat: settings.employeeNumberFormat,
      candidateReferenceFormat: settings.candidateReferenceFormat,
    },
  });

  const onSubmit = (values: z.infer<typeof numberingSchema>) => {
    try {
      settingsService.saveAppSettings({ ...settings, ...values }, getActorContext());
      toast.success("Numbering formats updated");
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      toast.error(e.message || "Failed to save settings");
    }
  };

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
