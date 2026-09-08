import holdScene from "@/assets/consultation-hold.jpg";

export const CONNECTING_HEADLINE = "Waiting for your adviser";
export const CONNECTING_LINE = "Susan is joining you now.";

/** Susan 2.0 connecting tile: consultation room + hold copy, no still of Susan. */
export function ConnectingHold({ radius }: { radius: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
      <img
        src={holdScene}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-[center_40%]"
      />
      <div
        className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center"
        style={{
          background: "linear-gradient(180deg, rgba(20, 17, 14, 0.42), rgba(20, 17, 14, 0.74))",
          color: "#f4efe6",
        }}
      >
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-[#c9a36a]">
          MortgageEasy
        </p>
        <h2 className="text-lg font-semibold leading-tight sm:text-xl">{CONNECTING_HEADLINE}</h2>
        <p className="mt-1.5 text-sm text-[#f4efe6]/85">{CONNECTING_LINE}</p>
      </div>
    </div>
  );
}
