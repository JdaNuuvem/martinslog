import { redirect } from 'next/navigation'

/**
 * Endereço antigo da caixa de entrada.
 *
 * As conversas ganharam item próprio no menu (`/conversas`); este caminho
 * continua existindo só para não quebrar favorito nem link já compartilhado.
 * Síncrona de propósito: não consulta nada — quem decide o acesso é a página
 * de destino.
 */
export default function RedirecionarConversas() {
  redirect('/conversas')
}
