import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Giriş yap" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Giriş yap</h1>
        <p className="text-sm text-neutral-600">SeoGrep hesabına eriş.</p>
      </div>
      <AuthForm mode="login" />
      <p className="text-sm text-neutral-600">
        Hesabın yok mu?{" "}
        <Link href="/signup" className="font-medium text-neutral-900 underline">
          Kayıt ol
        </Link>
      </p>
    </div>
  );
}
