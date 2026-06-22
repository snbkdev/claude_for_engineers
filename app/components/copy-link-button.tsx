import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "~/components/ui/button";

// Copies a full URL to the clipboard with brief "Copied" feedback.
export function CopyLinkButton({
  url,
  label = "Copy link",
}: {
  url: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} type="button">
      {copied ? (
        <>
          <Check className="mr-1.5 size-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="mr-1.5 size-3.5" />
          {label}
        </>
      )}
    </Button>
  );
}
