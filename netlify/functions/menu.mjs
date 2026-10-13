
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function reply(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function getEnv(name) {
  return process.env[name];
}

function authorized(request) {
  const expected = getEnv("ADMIN_PASSWORD");
  const supplied = request.headers.get("x-admin-password");

  return Boolean(expected && supplied && supplied === expected);
}

async function supabase(path, options = {}) {
  const base = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SECRET_KEY");

  if (!base || !key) {
    throw new Error(
      "Netlify ortam değişkenleri eksik: SUPABASE_URL ve SUPABASE_SECRET_KEY gerekli."
    );
  }

  const requestHeaders = {
    apikey: key,
    "Content-Type": "application/json",
    ...(key.startsWith("sb_secret_")
      ? {}
      : { Authorization: `Bearer ${key}` }),
    ...(options.headers || {})
  };

  const response = await fetch(
    `${base.replace(/\/$/, "")}/rest/v1/${path}`,
    {
      ...options,
      headers: requestHeaders
    }
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.hint ||
      data?.details ||
      `Supabase isteği başarısız: HTTP ${response.status}`
    );
  }

  return data;
}

function validProduct(body) {
  return (
    body &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    typeof body.category === "string" &&
    body.category.trim().length > 0 &&
    Number.isFinite(Number(body.price)) &&
    Number(body.price) >= 0
  );
}

export default async function handler(request, context) {
  try {
    const url = new URL(request.url);
    const method = request.method;
    const action = url.searchParams.get("action");
    const id = url.searchParams.get("id");

    // Yönetici girişi
    if (method === "POST" && action === "login") {
      const body = await request.json();
      const expected = getEnv("ADMIN_PASSWORD");

      if (!expected) {
        return reply(500, {
          error: "Netlify ADMIN_PASSWORD değişkeni ayarlanmamış."
        });
      }

      if (body.password !== expected) {
        return reply(401, { error: "Şifre yanlış." });
      }

      return reply(200, { ok: true });
    }

    // Menü listesini getir
    if (method === "GET") {
      const data = await supabase(
        "menu?select=id,name,category,price&order=id.asc"
      );

      return reply(200, data || []);
    }

    // Diğer işlemler yönetici girişi gerektirir
    if (!["POST", "PUT", "DELETE"].includes(method)) {
      return reply(405, {
        error: "Bu işlem desteklenmiyor."
      });
    }

    if (!authorized(request)) {
      return reply(401, {
        error: "Yönetici girişi gerekli. Lütfen yeniden giriş yap."
      });
    }

    // Yeni ürün ekle
    if (method === "POST") {
      const body = await request.json();

      if (!validProduct(body)) {
        return reply(400, {
          error: "Ürün adı, kategori ve geçerli fiyat gerekli."
        });
      }

      const data = await supabase("menu", {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          name: body.name.trim(),
          category: body.category.trim(),
          price: Number(body.price)
        })
      });

      return reply(201, data);
    }

    if (!id) {
      return reply(400, {
        error: "Ürün kimliği eksik."
      });
    }

    // Ürünü düzenle
    if (method === "PUT") {
      const body = await request.json();

      if (!validProduct(body)) {
        return reply(400, {
          error: "Ürün adı, kategori ve geçerli fiyat gerekli."
        });
      }

      const data = await supabase(
        `menu?id=eq.${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            name: body.name.trim(),
            category: body.category.trim(),
            price: Number(body.price)
          })
        }
      );

      return reply(200, data);
    }

    // Ürünü sil
    if (method === "DELETE") {
      await supabase(
        `menu?id=eq.${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );

      return reply(200, { ok: true });
    }

    return reply(405, {
      error: "Bu işlem desteklenmiyor."
    });
  } catch (error) {
    return reply(500, {
      error: error?.message || "Sunucu hatası."
    });
  }
}
