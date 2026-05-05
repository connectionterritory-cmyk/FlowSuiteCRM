import { supabase } from './supabase/client'

export interface NextStepRecommendation {
  case_id: string
  cliente_id: string | null
  recommended_action: string
  recommended_agreement_type: string | null
  reason: string
  risk_level: string
  has_active_ptp: boolean
  has_overdue_ptp: boolean
  last_gestion_at: string | null
  suggested_followup_date: string | null
  missing_data: string[]
  warnings: string[]
}

/**
 * Servicio para gestionar recomendaciones de acuerdos de pago.
 * Conecta con la RPC fn_case_next_step_agreement.
 */
export const PaymentAgreementService = {
  /**
   * Obtiene la recomendación del próximo paso de cobranza para un caso.
   * Solo lectura, llama a la RPC 0142.
   */
  async getNextStepRecommendation(caseId: string): Promise<NextStepRecommendation | null> {
    try {
      const { data, error } = await supabase.rpc('fn_case_next_step_agreement', {
        p_case_id: caseId,
      })

      if (error) {
        console.error('Error fetching recommendation:', error)
        return null
      }

      // La RPC devuelve una tabla, tomamos la primera fila
      const results = data as NextStepRecommendation[]
      return results?.[0] || null
    } catch (error) {
      console.error('PaymentAgreementService error:', error)
      return null
    }
  },

  /**
   * Busca el ID del caso de cargo de vuelta activo para un cliente.
   */
  async findActiveCaseForClient(clienteId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('cargo_vuelta_cases')
        .select('id')
        .eq('cliente_id', clienteId)
        .neq('estado', 'Cerrado')
        .neq('estado', 'Cancelado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error || !data) return null
      return data.id
    } catch (error) {
      console.error('Error finding active case:', error)
      return null
    }
  },
}
