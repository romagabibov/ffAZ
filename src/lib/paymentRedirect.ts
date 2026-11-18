export type PaymentForm = { action: string; fields: Record<string, string> };
export type PaymentRedirect = { paymentUrl?: string; paymentForm?: PaymentForm };

export function openPayment(redirect: PaymentRedirect): boolean {
  if (redirect.paymentForm) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = redirect.paymentForm.action;
    form.hidden = true;
    for (const [name, value] of Object.entries(redirect.paymentForm.fields)) {
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = name;
      field.value = value;
      form.append(field);
    }
    document.body.append(form);
    form.submit();
    form.remove();
    return true;
  }
  if (redirect.paymentUrl) {
    window.location.assign(redirect.paymentUrl);
    return true;
  }
  return false;
}
