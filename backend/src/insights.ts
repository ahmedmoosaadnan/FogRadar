export type InsightHazardInput = {
  type: string;
  latitude: number;
  longitude: number;
  ageMinutes: number;
  reportCount: number;
};

export type RouteInsightsData = {
  route: string;
  liveVehicles: number;
  hazards: InsightHazardInput[];
};

export type InsightsResponse = {
  summary_en: string;
  summary_ur: string;
  generatedAt: number;
};

const VALID_ROUTES = new Set([
  'M-1 Motorway',
  'M-2 Motorway',
  'M-3 Motorway',
  'M-4 Motorway',
  'M-5 Motorway',
  'M-9 Motorway',
]);

const URDU_HAZARD_LABELS: Record<string, string> = {
  'Stopped traffic': 'رکی ہوئی ٹریفک',
  Accident: 'حادثہ',
  'Heavy fog': 'شدید دھند',
  'Vehicle breakdown': 'گاڑی کی خرابی',
};

export function normalizeRouteParam(raw: unknown): string {
  if (typeof raw !== 'string') return 'M-2 Motorway';
  const trimmed = raw.trim();
  if (VALID_ROUTES.has(trimmed)) return trimmed;
  const shortMatch = /^(M-[123459])(?:\s+Motorway)?$/i.exec(trimmed);
  if (shortMatch) {
    const candidate = `${shortMatch[1].toUpperCase()} Motorway`;
    if (VALID_ROUTES.has(candidate)) return candidate;
  }
  return 'M-2 Motorway';
}

export function buildDeterministicInsights(data: RouteInsightsData, now = Date.now()): InsightsResponse {
  const { route, liveVehicles, hazards } = data;
  if (liveVehicles === 0 && hazards.length === 0) {
    return {
      summary_en: `No FogRadar data for this route right now (${route}: 0 connected vehicles and 0 corroborated hazard reports). Actual road, traffic, and visibility conditions are unknown because unconnected vehicles and unreported hazards are not detected.`,
      summary_ur: `اس وقت ${route} کے لیے کوئی FogRadar ڈیٹا موجود نہیں ہے (0 منسلک گاڑیاں اور 0 تصدیق شدہ رپورٹس)۔ سڑک، ٹریفک یا حدِ نگاہ کی اصل صورتحال معلوم نہیں ہے کیونکہ بغیر ایپ والی گاڑیاں اور غیر رپورٹ شدہ خطرات نظر نہیں آتے۔`,
      generatedAt: now,
    };
  }

  if (hazards.length === 0) {
    return {
      summary_en: `FogRadar currently tracks ${liveVehicles} connected vehicle(s) and 0 corroborated hazard reports on ${route}. Having 0 reports does not indicate what road or visibility conditions exist, as unconnected vehicles and unreported hazards remain undetected.`,
      summary_ur: `اس وقت ${route} پر ${liveVehicles} منسلک گاڑیاں ٹریک ہو رہی ہیں اور 0 تصدیق شدہ خطرات رپورٹ ہوئے ہیں۔ صفر رپورٹس سے سڑک یا حدِ نگاہ کی صورتحال معلوم نہیں ہوتی کیونکہ بغیر ایپ والی گاڑیاں اور غیر رپورٹ شدہ خطرات نظر نہیں آتے۔`,
      generatedAt: now,
    };
  }

  const detailsEn = hazards
    .slice(0, 3)
    .map(
      h =>
        `${h.type} near (${h.latitude.toFixed(3)}°N, ${h.longitude.toFixed(3)}°E, ${h.ageMinutes}m ago, ${h.reportCount} confirming vehicles)`
    )
    .join('; ');

  const detailsUr = hazards
    .slice(0, 3)
    .map(
      h =>
        `${URDU_HAZARD_LABELS[h.type] ?? h.type} (${h.latitude.toFixed(3)}°N, ${h.longitude.toFixed(3)}°E، ${h.ageMinutes} منٹ قبل، ${h.reportCount} تصدیقی گاڑیاں)`
    )
    .join('؛ ');

  return {
    summary_en: `On ${route}, ${hazards.length} corroborated hazard report(s) are active — ${detailsEn} — with ${liveVehicles} connected vehicle(s) currently sending telemetry. Unconnected vehicles and unreported hazards are not detected by FogRadar.`,
    summary_ur: `${route} پر اس وقت ${hazards.length} تصدیق شدہ خطرات کی رپورٹس موجود ہیں — ${detailsUr} — اور ${liveVehicles} منسلک گاڑیاں ٹیلی میٹری بھیج رہی ہیں۔ بغیر ایپ والی گاڑیاں اور غیر رپورٹ شدہ خطرات FogRadar پر نظر نہیں آتے۔`,
    generatedAt: now,
  };
}

export async function requestLlmInsights(
  data: RouteInsightsData,
  apiKey: string | undefined,
  model: string | undefined,
  now = Date.now()
): Promise<InsightsResponse> {
  const trimmedKey = (apiKey ?? '').trim();
  const trimmedModel = (model ?? '').trim();
  if (!trimmedKey || !trimmedModel || (data.liveVehicles === 0 && data.hazards.length === 0)) {
    return buildDeterministicInsights(data, now);
  }

  const hazardLines =
    data.hazards.length > 0
      ? data.hazards
          .slice(0, 5)
          .map(
            (h, i) =>
              `${i + 1}. ${h.type} at (${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}), age ${h.ageMinutes} min, confirmed by ${h.reportCount} vehicles`
          )
          .join('\n')
      : 'None (0 active corroborated hazard reports)';

  const prompt = [
    `You summarize only the provided FogRadar telemetry for Pakistan's ${data.route}.`,
    `Live connected vehicles on route: ${data.liveVehicles}.`,
    `Active corroborated hazard reports:\n${hazardLines}`,
    `Write a concise 2-sentence summary in English (summary_en) and a 2-sentence summary in Urdu (summary_ur) following these strict rules:`,
    `- When live connected vehicles is 0 and active corroborated hazard reports is 0, summary_en MUST begin with "No FogRadar data for this route right now" and state that actual road and visibility conditions are unknown.`,
    `- NEVER claim or imply that road, traffic, or travel conditions are clear, open, normal, or safe.`,
    `- NEVER state road, weather, or visibility conditions that are not explicitly shown in the data above; always note that unconnected vehicles and unreported hazards are not detected.`,
    `Respond ONLY with valid JSON in this exact shape: {"summary_en":"...","summary_ur":"..."}`,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    let rawText = '';
    const isGemini = /^gemini/i.test(trimmedModel) || trimmedKey.startsWith('AIza');

    if (isGemini && !process.env.LLM_API_URL) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(trimmedModel)}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else {
      const url = (process.env.LLM_API_URL ?? 'https://api.openai.com/v1/chat/completions').trim();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${trimmedKey}`,
        },
        body: JSON.stringify({
          model: trimmedModel,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You output only valid JSON objects with keys "summary_en" and "summary_ur". Never claim roads are clear or safe, and never state conditions not shown by the telemetry.',
            },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      rawText = json.choices?.[0]?.message?.content ?? '';
    }

    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as { summary_en?: unknown; summary_ur?: unknown };
    if (
      typeof parsed.summary_en === 'string' &&
      parsed.summary_en.trim().length > 0 &&
      typeof parsed.summary_ur === 'string' &&
      parsed.summary_ur.trim().length > 0
    ) {
      return {
        summary_en: parsed.summary_en.trim(),
        summary_ur: parsed.summary_ur.trim(),
        generatedAt: now,
      };
    }
    return buildDeterministicInsights(data, now);
  } catch {
    return buildDeterministicInsights(data, now);
  } finally {
    clearTimeout(timer);
  }
}
