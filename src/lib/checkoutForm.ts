import { CHECKOUT_FORM } from "../config";

export type CheckoutDetails = {
  fullName: string;
  age: string;
  whatsapp: string;
  email: string;
  feedback: string;
};

/** The entry.<id> params Google's endpoint expects, keyed the same as the UI. */
function formValues(d: CheckoutDetails): Record<string, string> {
  return {
    [CHECKOUT_FORM.fields.fullName]: d.fullName,
    [CHECKOUT_FORM.fields.age]: d.age,
    [CHECKOUT_FORM.fields.whatsapp]: d.whatsapp,
    [CHECKOUT_FORM.fields.feedback]: d.feedback,
    emailAddress: d.email, // Google's "collect email" field — required by the form
    ifq: "", // tell Google this is a background submission
    source: "arora-time-centre-website",
  };
}

/**
 * Silently posts the shopper's details to the store's Google Form from
 * inside the site — the customer never sees Google. The response lands in
 * the form's linked spreadsheet (name, age, WhatsApp number, email and
 * feedback; the email is repeated in the WhatsApp message too). Because the
 * form *requires* an email, the payload must carry a non-empty `emailAddress`
 * or Google rejects it with validation-failed and nothing is saved.
 *
 * Primary path is a CORS-simple `fetch` (form-urlencoded, no-cors,
 * keepalive so it survives the WhatsApp tab opening). A hidden off-screen
 * iframe form-POST is the fallback for browsers where that fetch throws.
 * Either way it's best-effort — Google being slow must never block the
 * shopper from reaching WhatsApp.
 */
export async function sendToGoogleForm(d: CheckoutDetails): Promise<void> {
  const body = new URLSearchParams(formValues(d));
  try {
    await fetch(CHECKOUT_FORM.url, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    postViaIframe(body);
  }
}

/** Off-screen iframe fallback — completely bypasses CORS. */
function postViaIframe(body: URLSearchParams): void {
  const frameName = "arora-gform-relay";
  document.getElementById(frameName)?.remove();

  const frame = document.createElement("iframe");
  frame.name = frameName;
  frame.id = frameName;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:0";

  const form = document.createElement("form");
  form.method = "POST";
  form.action = CHECKOUT_FORM.url;
  form.target = frameName;
  for (const [name, value] of body.entries()) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(frame);
  document.body.appendChild(form);
  // an input named "submit" shadows form.submit, so call it via the prototype
  HTMLFormElement.prototype.submit.call(form);
  form.remove();
  window.setTimeout(() => frame.remove(), 4000);
}
