export function employeeDocumentLink(employeeId: string, documentId: string): string {
  return `/staff/employees/${encodeURIComponent(employeeId)}#section=documents&document=${encodeURIComponent(documentId)}`;
}
