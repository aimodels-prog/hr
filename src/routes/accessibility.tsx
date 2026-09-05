import { createFileRoute } from "@tanstack/react-router";

import { PublicInformationPage } from "@/components/public-information-page";

export const Route = createFileRoute("/accessibility")({
  head: () => ({ meta: [{ title: "Accessibility | VIA International Careers" }] }),
  component: AccessibilityPage,
});

function AccessibilityPage() {
  return (
    <PublicInformationPage
      eyebrow="Accessibility"
      title="A Careers portal everyone can use"
      introduction="VIA International aims to make job information and applications usable across devices and with assistive technology."
    >
      <section>
        <h2>Our approach</h2>
        <p>
          The portal is designed with keyboard navigation, visible focus states, labelled form
          controls, readable contrast, responsive layouts and meaningful page structure. We review
          important candidate journeys as the service develops.
        </p>
      </section>
      <section>
        <h2>Alternative support</h2>
        <p>
          If a disability or accessibility barrier prevents you from reviewing a vacancy or
          completing an application, email <a href="mailto:hr@via-int.com">hr@via-int.com</a>. Tell
          us which page or step is affected and what assistance you need. Do not include medical
          details that are unnecessary for arranging support.
        </p>
      </section>
      <section>
        <h2>Report a problem</h2>
        <p>
          We welcome clear accessibility feedback. Include the page address, device or browser and a
          brief description of the problem so the team can investigate it effectively.
        </p>
      </section>
    </PublicInformationPage>
  );
}
