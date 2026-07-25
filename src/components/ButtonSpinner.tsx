export default function ButtonSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 50 50"
      className="animate-spin inline-block"
      style={{ width: size, height: size, animationDuration: "0.75s" }}
    >
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="90, 150"
        strokeDashoffset="0"
        opacity="0.3"
      />
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="40, 150"
        strokeDashoffset="-10"
      />
    </svg>
  );
}
