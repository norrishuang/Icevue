import logoUrl from "../assets/icevue-logo.svg";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src={logoUrl}
      alt="Icevue"
    />
  );
}
