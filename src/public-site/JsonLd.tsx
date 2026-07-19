// JSON-LD-script voor structured data (fase 9). Server component.
// De vervanging van "<" voorkomt dat aanvallersinput ooit "</script>"
// in de HTML kan injecteren (defense in depth — de data komt uit het
// eigen read-model, maar structured data blijft tekstuele output).

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
