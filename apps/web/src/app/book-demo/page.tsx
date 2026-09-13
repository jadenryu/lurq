import { redirect } from "next/navigation";

export default function BookDemoPage() {
  // The contact form on the landing page is the real way to reach us; this path
  // stays so old links land there instead of on a 404.
  redirect("/#contact");
}
