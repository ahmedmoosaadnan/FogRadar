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
  if (hazards.length === 0) {
    return {
      summary_en: `No corroborated hazards are currently active on ${route}, with ${liveVehicles} connected vehicle(s) sharing live GPS telemetry. Unconnected traffic is not visible on radar, so maintain safe headway and moderate speed in low visibility.`,
      summary_ur: `${route} پر اس وقت کوئی تصدیق شدہ خطرہ موجود نہیں ہے اور ${liveVehicles} منسلک گاڑیاں لائیو ٹیلی میٹری شیئر کر رہی ہیں۔ ایپ کے بغیر گاڑیاں ریڈار پر نظر نہیں آتیں، اس لیے دھند میں محفوظ فاصلہ اور مناسب رفتار برقرار رکھیں۔`,
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
    summary_en: `On ${route}, ${hazards.length} corroborated hazard(s) are active — ${detailsEn} — alongside ${liveVehicles} live connected vehicle(s). Reduce speed immediately, increase following distance, and stay alert for sudden slowdowns.`,
    summary_ur: `${route} پر اس وقت ${hazards.length} تصدیق شدہ خطرات موجود ہیں — ${detailsUr} — اور ${liveVehicles} منسلک گاڑیاں لائیو ٹریک ہو رہی ہیں۔ براہِ کرم رفتار کم کریں، اگلی گاڑی سے فاصلہ بڑھائیں اور احتیاط سے ڈرائیو کریں۔`,
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
  if (!trimmedKey || !trimmedModel) {
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
      : 'None (0 active corroborated hazards)';

  const prompt = [
    `You are generating an advisory summary for FogRadar on Pakistan's ${data.route}.`,
    `Live connected vehicles on route: ${data.liveVehicles}.`,
    `Active corroborated hazards:\n${hazardLines}`,
    `Write a concise 2-sentence road safety summary in English (summary_en) and a 2-sentence road safety summary in Urdu (summary_ur) reflecting this exact telemetry.`,
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
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
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
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You output only valid JSON objects with keys "summary_en" and "summary_ur".',
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

