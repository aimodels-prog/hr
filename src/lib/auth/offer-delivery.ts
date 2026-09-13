export interface ManualOfferDelivery {
  recipientEmail: string;
  sentAt: string;
  evidenceReference: string;
  confirmed: boolean;
}

/** Records HR's attested manual dispatch, never claims automatic email delivery. */
export function validateManualOfferDelivery(
  value: ManualOfferDelivery | undefined,
  candidateEmail: string,
  now = Date.now(),
) {
  if (!value?.confirmed)
    throw new Error(
      "Confirm manual sending and provide delivery evidence before marking the offer Sent.",
    );
  if (value.recipientEmail.trim().toLowerCase() !== candidateEmail.trim().toLowerCase())
    throw new Error("The recipient must match the candidate's email.");
  const sent = Date.parse(value.sentAt);
  if (!Number.isFinite(sent) || sent > now)
    throw new Error("Enter a valid sending time that is not in the future.");
  const evidence = value.evidenceReference.trim();
  if (
    evidence.length < 10 ||
    evidence.length > 2000 ||
    !/^(https:\/\/\S+|<[^<>\s]+@[^<>\s]+>)$/.test(evidence)
  )
    throw new Error(
      "Provide a sent-message evidence HTTPS link or the email Message-ID in <...@...> format.",
    );
  return {
    recipientEmail: value.recipientEmail.trim().toLowerCase(),
    sentAt: new Date(sent).toISOString(),
    evidenceReference: evidence,
    confirmed: true,
  };
}
