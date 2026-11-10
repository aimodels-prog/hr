/** Keep booking intent visible to every reviewer without changing the travel-request schema. */
export function travelRequestNotes(needsCompanyBooking: boolean, notes: string): string {
  const preference = needsCompanyBooking
    ? "VIA booking requested after trip approval. A separate booking request is still required."
    : "No VIA booking requested. Estimated costs, if any, may be claimed after the trip.";
  const detail = notes.trim();
  return detail ? `${preference}\n\n${detail}` : preference;
}
