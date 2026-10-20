import "server-only";
import { cookies, headers } from "next/headers";
import { dictionaries, pickLang, type Lang, type VisitorDict } from "./visitor";

export const LANG_COOKIE = "dr_lang";

export async function visitorLang(): Promise<{ lang: Lang; t: VisitorDict }> {
  const lang = pickLang((await cookies()).get(LANG_COOKIE)?.value, (await headers()).get("accept-language"));
  return { lang, t: dictionaries[lang] };
}
