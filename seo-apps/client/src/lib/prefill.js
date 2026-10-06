// Values the Northaxis platform hands a tool when it opens the tool for one client account
// (app.py, /<account>/seo-aeo/<tool>): ?pf_url= (the account's website), ?pf_domain=, ?pf_keyword=
// (its first service and city), ?pf_service=. A form reads them once, when it first draws, and the
// person can change them; with none in the address every form starts empty, as before.
export function prefill(key) {
  try {
    return (new URLSearchParams(window.location.search).get('pf_' + key) || '').slice(0, 500);
  } catch {
    return '';
  }
}
