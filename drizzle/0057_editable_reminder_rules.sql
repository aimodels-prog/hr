UPDATE app_settings
SET additional_settings = additional_settings || jsonb_build_object('reminderRules',
  '{"travelEnabled":true,"travelAfterHours":48,"trainingEnabled":true,"trainingExpiryDays":[60,30,14,7,0],"leaveEnabled":true,"annualEveryMonths":1,"carryDeadline":"04-30","carryExtraDays":[15,7,1],"offerEnabled":true,"offerBeforeHours":48,"missingClockoutEnabled":true,"missingClockoutStart":"09:00","missingClockoutEnd":"12:00"}'::jsonb)
WHERE NOT (additional_settings ? 'reminderRules');
