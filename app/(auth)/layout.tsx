export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-red-700 to-red-900 flex flex-col items-center justify-center px-4 py-12">
      {/* Logo / Branding */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-white shadow-xl mb-4 overflow-hidden">
          <img
            src="/crests/spvgg-wildenroth.png"
            alt="SpVgg Wildenroth"
            className="w-20 h-20 object-contain"
          />
        </div>
        <h1 className="text-3xl font-black text-white tracking-tight">
          Wildenroth
        </h1>
        <p className="text-red-200 text-sm font-medium mt-1 tracking-widest uppercase">
          Tippspiel
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
        {children}
      </div>

      <p className="mt-6 text-red-200 text-xs">
        SpVgg Wildenroth &copy; {new Date().getFullYear()}
      </p>
    </div>
  )
}
