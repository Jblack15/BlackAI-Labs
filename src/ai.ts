const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new MissingApiKeyError("ANTHROPIC_API_KEY is not configured");
  }
  return key;
}

export class MissingApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingApiKeyError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export async function explainEstimate(estimateText: string): Promise<string> {
  const apiKey = getApiKey();

  const systemPrompt = `You are an expert auto repair estimator who translates technical repair estimates into plain English that customers can understand. 

Rules:
- Explain each line item in 1-2 simple sentences
- Never invent or guess information not present in the estimate
- Use friendly, reassuring language
- Format your response in Markdown with these sections:
  ### What we're doing
  A brief 2-3 sentence summary of the overall repair
  
  ### Breakdown
  For each line item, explain in plain English with the hours in parentheses
  
  ### Why it matters
  Brief explanation of why these steps are needed
  
  ### Total labor
  Sum up the total hours
  
Key terminology to translate:
- R&I = Remove & Install (take off the old part, inspect, put back or replace)
- R&R = Remove & Replace (take off the old part, install a new one)
- LKQ = Like Kind & Quality (an aftermarket or used part, not from the manufacturer)
- OEM = Original Equipment Manufacturer (a genuine part from the car's manufacturer)
- Feather/Block = A paint blending technique to smooth the surface
- Overlap = Blending paint into adjacent panels to match color
- Blend = Painting beyond the repair area to ensure the color matches perfectly
- Clear Coat = A protective transparent layer applied over paint`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Please translate this auto repair estimate into plain English:\n\n${estimateText}`,
        },
      ],
    }),
  });

  if (response.status === 429) {
    throw new RateLimitError("Rate limit exceeded. Please try again in a moment.");
  }

  if (!response.ok) {
    const text = await response.text();
    let message = "AI request failed";
    try {
      const err = JSON.parse(text);
      message = err.error?.message || message;
    } catch {
      // Use fallback message
    }
    throw new Error(message);
  }

  const data = await response.json();
  return data.content[0].text;
}
