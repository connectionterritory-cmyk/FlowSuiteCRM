import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase/client'

export const isRealOutboxDispatchEnabled = import.meta.env.VITE_ENABLE_REAL_OUTBOX_DISPATCH === 'true'

export type DispatchOutboxMessageResult = {
  ok: boolean
  queued?: boolean
  outbox_id?: string
  status?: 'borrador' | 'programado' | 'en_proceso' | 'enviado' | 'fallido' | 'retry_pending' | 'cancelado' | string
  provider?: string | null
  provider_message_id?: string | null
  error_message?: string | null
  error_code?: string
  message?: string
  attempt_count?: number | null
  dispatch_provider?: string | null
}

async function parseInvokeError(error: unknown): Promise<DispatchOutboxMessageResult> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json() as DispatchOutboxMessageResult | null
      if (body && typeof body === 'object') {
        return {
          ...body,
          ok: false,
          message: body.message || body.error_message || error.message,
        }
      }
    } catch {
      return {
        ok: false,
        error_code: 'http_error',
        message: error.message,
      }
    }
  }

  if (error instanceof Error) {
    return {
      ok: false,
      error_code: 'invoke_error',
      message: error.message,
    }
  }

  return {
    ok: false,
    error_code: 'invoke_error',
    message: 'No se pudo despachar el mensaje',
  }
}

export async function dispatchOutboxMessage(outboxId: string): Promise<DispatchOutboxMessageResult> {
  const { data, error } = await supabase.functions.invoke<DispatchOutboxMessageResult>('dispatch-outbox-message', {
    body: { outbox_id: outboxId },
  })

  if (error) {
    return parseInvokeError(error)
  }

  if (!data) {
    return {
      ok: false,
      error_code: 'empty_response',
      message: 'La función no devolvió respuesta',
    }
  }

  return data
}
