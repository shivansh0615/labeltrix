const base = "http://localhost:3000";

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ role: "admin", password: "Kharesiya$$9911" }),
});
const loginBody = await login.json();
const cookie = login.headers.getSetCookie?.()?.join("; ") || login.headers.get("set-cookie");
console.log("login", login.status, loginBody.ok ?? loginBody, "cookie?", Boolean(cookie));

const products = await fetch(`${base}/api/products?q=`, {
  headers: cookie ? { cookie } : {},
});
const productsBody = await products.json();
console.log(
  "products",
  products.status,
  Array.isArray(productsBody.products)
    ? `count=${productsBody.products.length}`
    : productsBody,
);

const packaging = await fetch(`${base}/api/packaging`, {
  headers: cookie ? { cookie } : {},
});
const packagingBody = await packaging.json();
console.log(
  "packaging",
  packaging.status,
  Array.isArray(packagingBody.runs)
    ? `count=${packagingBody.runs.length}`
    : packagingBody,
);
