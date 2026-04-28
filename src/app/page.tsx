import DateForecaster from "@/components/DateForecaster";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center gap-12 pt-10">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-warm-900 tracking-tight">
          Plan your Disneyland visit
        </h1>
        <p className="text-warm-700 mt-2 text-sm">
          Pick a date to see our crowd forecast and predicted wait times.
        </p>
      </div>
      <DateForecaster />
    </div>
  );
}
