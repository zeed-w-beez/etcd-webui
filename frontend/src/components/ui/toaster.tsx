import {
  Toast,
  ToastProvider,
  ToastViewport,
} from "@/components/ui/toast"

export function EtcdToaster() {
  return (
    <ToastProvider>
      <ToastViewport />
      <Toast />
    </ToastProvider>
  )
}
