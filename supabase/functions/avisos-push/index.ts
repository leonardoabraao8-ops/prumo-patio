// Avisos de agendamento do Pátio Prumo.
// Antes da hora: 30, 15 e 5 minutos (toque curto).
// Depois da hora, se ninguém pôs em rota: na hora e a cada 30 min (toque longo).
// Chamado a cada minuto pelo pg_cron do próprio banco. Também aceita
// { teste: endpoint } para o botão "Enviar teste" dos Ajustes.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-prumo",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Insc = { endpoint: string; p256dh: string; auth: string };

async function enviar(insc: Insc[], carga: Record<string, unknown>) {
  const mortos: string[] = [];
  let ok = 0;
  await Promise.all(insc.map(async (i) => {
    try {
      await webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
        JSON.stringify(carga), { TTL: 600, urgency: "high" });
      ok++;
    } catch (e) {
      const s = (e as { statusCode?: number }).statusCode;
      // aparelho desinstalou ou revogou: sai da lista
      if (s === 404 || s === 410) mortos.push(i.endpoint);
    }
  }));
  if (mortos.length) await db.from("push_inscricoes").delete().in("endpoint", mortos);
  return ok;
}

const hhmm = (h: string | null) => (h || "").slice(0, 5);

// volume e duração do alarme vêm do banco (Ajustes), iguais em todo aparelho
async function somAtual() {
  const { data } = await db.from("avisos_config").select("volume,antes,atraso").eq("id", 1).maybeSingle();
  return { vol: data?.volume ?? 70, antes: Number(data?.antes ?? 1.5), atraso: Number(data?.atraso ?? 2.5) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { data: cfg, error: e1 } = await db.rpc("push_config");
  if (e1 || !cfg?.privada) return json({ erro: "sem chaves" }, 500);
  webpush.setVapidDetails("mailto:prumo.assistencia@gmail.com", cfg.publica, cfg.privada);

  const corpo = await req.json().catch(() => ({}));

  // botão de teste: só manda para o aparelho que pediu, e só se ele estiver inscrito
  if (corpo?.teste) {
    const { data: i } = await db.from("push_inscricoes").select("endpoint,p256dh,auth").eq("endpoint", corpo.teste);
    if (!i?.length) return json({ erro: "aparelho não inscrito" }, 404);
    const n = await enviar(i as Insc[], {
      title: "Avisos do Pátio ligados",
      body: "Avisos 30, 15 e 5 min antes de cada agendamento, e a cada 30 min se passar da hora sem ninguém pôr em rota.",
      tag: "teste", url: "/", alerta: "curto", som: await somAtual(),
    });
    return json({ enviados: n });
  }

  if (req.headers.get("x-prumo") !== cfg.token) return json({ erro: "não autorizado" }, 401);

  const { data: devidos, error: e2 } = await db.rpc("avisos_devidos");
  if (e2) return json({ erro: e2.message }, 500);
  if (!devidos?.length) return json({ avisos: 0 });
  const { data: insc } = await db.rpc("inscricoes_editores");
  const som = await somAtual();

  let avisos = 0;
  for (const v of devidos) {
    // marca antes de mandar: duas chamadas ao mesmo tempo não avisam duas vezes
    const { data: marcado } = await db.from("avisos_enviados")
      .upsert({ veiculo: v.id, marco: v.marco, alvo: v.alvo }, { onConflict: "veiculo,marco,alvo", ignoreDuplicates: true })
      .select();
    if (!marcado?.length) continue;
    avisos++;
    if (!insc?.length) continue;
    const atrasado = v.marco <= 0;
    const quem = [v.placa, v.modelo].filter(Boolean).join(" · ");
    const titulo = !atrasado ? `Em ${v.minutos} min · ${quem}`
      : v.marco === 0 ? `Chegou a hora · ${quem}`
      : `Atrasado ${Math.abs(v.marco)} min · ${quem}`;
    let corpoMsg = v.direta
      ? `Fora de base às ${hhmm(v.hora)} — coletar em ${v.origem || "endereço a confirmar"}` +
        (v.vai_com ? ` · junto com ${v.vai_com}` : "")
      : `Saída de base às ${hhmm(v.hora)} → ${v.destino || "destino a definir"}` +
        (v.cidade && !(v.destino || "").toLowerCase().includes(v.cidade.toLowerCase()) ? ` · ${v.cidade}` : "") +
        (v.leva ? ` · leva ${v.leva}` : "");
    if (atrasado) corpoMsg = `Ninguém pôs em rota ainda. ${corpoMsg}`;
    await enviar(insc as Insc[], {
      title: titulo, body: corpoMsg, tag: `${v.id}-${v.marco}`, url: `/?v=${v.id}`,
      alerta: atrasado ? "longo" : "curto", som,
      // atrasado fica na tela até alguém tocar
      insistente: atrasado,
    });
  }
  return json({ avisos });
});
