const targets = [
  "http://localhost:3000",
  "https://labeltrix.algorithmtrix.com",
];

const passwords = [
  "admin@123",
  "Admin@123",
  "Kharesiya$$9911",
  "Kharesiya$9911",
  '"Kharesiya$$9911"',
  "Viewer@123",
];

for (const base of targets) {
  console.log("\n===", base, "===");
  for (const role of ["admin", "viewer"]) {
    for (const password of passwords) {
      try {
        const r = await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role, password }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          console.log("OK", role, JSON.stringify(password), "->", j.role);
        }
      } catch (e) {
        console.log("ERR", base, e instanceof Error ? e.message : e);
        break;
      }
    }
  }
}
