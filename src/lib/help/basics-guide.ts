import { article } from "./guide.ts";

export const basicsGuide = [
  article(
    "form-basics",
    "employee",
    "Getting started",
    "Fill in a form without losing your work",
    "Understand required fields, attachments, drafts and the final submit button.",
    "/staff/help",
    "asterisk star required optional disabled grey button draft submit save attachment upload date format form search colleague employee selector",
    [
      "Read the form title first so you know which employee, request or period you are changing. A star beside a field means it must be completed when required by the selected options.",
      "Complete the labelled fields. Use the date picker if the date format is unfamiliar. Review any dates or times already filled in for you; they are suggestions, not confirmation of what happened.",
      "To choose a colleague, supervisor or employee, open the field with the search symbol and type their name. You can also search by work email or employee number where available. Select the correct result; typing alone does not select someone. Only people eligible for that field are listed.",
      "For a file, choose the document matching the person and purpose. Check the file type and maximum size written beside the upload button. Wait for any required upload check to finish.",
      "Review the form before choosing its final action. Save Draft keeps unfinished work; Submit or Send for approval asks someone to review it. Upload & share on payslips shares immediately.",
      "Read the result message and reopen the list to confirm the record appears. If you are unsure whether it saved, check first before submitting again.",
    ],
    "A disabled button usually means required information or an earlier step is missing. Read the nearby message rather than repeatedly clicking it.",
    [
      "Changing a leave type or document area may show extra fields. Recheck the whole form after changing the choice.",
      "If there is no Save Draft button, do not assume the form saves automatically when you close it or leave the page.",
      "Do not upload another employee’s document or use example details from a help screenshot.",
    ],
  ),
  article(
    "request-statuses",
    "employee",
    "Getting started",
    "What do request statuses mean?",
    "Know whether to wait, make a correction or start the next step.",
    "/staff/requests",
    "draft pending approved rejected declined returned cancelled status taken submitted notification waiting who approval",
    [
      "Open My Requests or Approvals and find the original request. Read the status on the record, not just an old notification.",
      "Draft means it is not yet submitted. Pending or Awaiting means someone still needs to act; read the named stage or reviewer.",
      "Returned means the reviewer needs a correction. Read their explanation, change the original request where allowed and submit again. Rejected or Declined means it was not approved.",
      "Approved means the required approval for that record is complete. Check whether a separate next action still exists, such as payment, travel settlement or sending an offer.",
      "Cancelled or Withdrawn means that request is no longer going ahead. Check that the correct record was cancelled before making a new request.",
    ],
    "A notification is a message about a record, not the record itself. Always open the linked record to check its latest decision.",
    [
      "Ask HR if a request is assigned to the wrong person. Do not create duplicate requests to move ahead in a queue.",
      "An approved expense is not necessarily paid. Finance can confirm the settlement stage.",
    ],
  ),
  article(
    "help-navigation",
    "employee",
    "Getting started",
    "Use this Help guide on a computer or phone",
    "Find an answer, follow the steps and return to the app.",
    "/staff/help",
    "help search screen image screenshot enlarge mobile phone menu sidebar guide beginner learn how",
    [
      "Open Help & Knowledge in the main menu. Start with your role’s starting checklist if you are new.",
      "Type a short phrase such as forgot clock out or leave balance in the help search box and choose Search. Search menu in the sidebar finds app pages; the Help search box finds instructions.",
      "Open a matching article. Read Before you begin where shown, then follow Step by step. Use What happens next to check the result.",
      "Where there is a screen example, choose Enlarge example to read it more clearly. Close it with the close button or Escape on a keyboard. Examples are not your actual employee records.",
      "Choose Open in VIA HR to go to the relevant page. You can use your browser’s Back button to return to the guide, or open the page link in another tab if you want the guide beside it.",
    ],
    "On a phone, use the menu button to find topics. Help follows your active role; an HR or Finance article link does not give you that role’s access.",
    [
      "If the image does not load, the field explanations and written steps still work.",
      "If you cannot find the answer, use Something is missing or will not save and give HR the page name and exact problem without passwords or private attachments.",
    ],
  ),
];
