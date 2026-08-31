import { z } from 'zod'

/**
 * Schemas da borda HTTP das ações administrativas sobre um usuário.
 *
 * Ficam em `lib/` porque o formulário do painel importa os mesmos schemas
 * para validar antes de enviar: uma regra só, checada nos dois lados, em vez
 * de duas cópias que divergem na primeira mudança.
 */

/** Teto por ajuste: R$ 100.000,00. Acima disso é dedo escorregando no zero. */
const TETO_AJUSTE_CENTAVOS = 10_000_000

const motivoSchema = z
  .string()
  .trim()
  .min(3, 'Descreva o motivo (mínimo de 3 caracteres).')
  .max(200, 'Motivo muito longo (máximo de 200 caracteres).')

export const ajusteSaldoSchema = z.object({
  tipo: z.enum(['CREDITO', 'DEBITO'], {
    errorMap: () => ({ message: 'Escolha creditar ou debitar.' }),
  }),
  valorCentavos: z
    .number()
    .int('O valor deve estar em centavos inteiros.')
    .positive('O valor deve ser maior que zero.')
    .max(TETO_AJUSTE_CENTAVOS, 'Valor acima do limite por ajuste.'),
  motivo: motivoSchema,
})

export type AjusteSaldoEntrada = z.infer<typeof ajusteSaldoSchema>

const enderecoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório'),
  documento: z.string().trim().optional(),
  email: z.string().trim().email('E-mail inválido').optional().or(z.literal('')),
  telefone: z.string().trim().optional(),
  cep: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
  logradouro: z.string().trim().min(1, 'Logradouro é obrigatório'),
  numero: z.string().trim().min(1, 'Número é obrigatório'),
  complemento: z.string().trim().optional(),
  bairro: z.string().trim().min(1, 'Bairro é obrigatório'),
  cidade: z.string().trim().min(1, 'Cidade é obrigatória'),
  uf: z.string().trim().length(2, 'UF deve ter 2 letras'),
})

const produtoSchema = z.object({
  nome: z.string().trim().min(1, 'Nome do produto é obrigatório'),
  quantidade: z.number().int().positive('Quantidade deve ser um inteiro positivo'),
  valorUnitarioCentavos: z.number().int().positive('Valor unitário deve ser positivo'),
})

/**
 * Criação de etiqueta pelo painel. Não tem campo de preço nenhum, pelo mesmo
 * motivo de `POST /api/envios`: o valor vem da cotação gerada no servidor, e
 * o Zod descarta chaves desconhecidas — mandar `precoCobradoCentavos` no
 * corpo não muda nada.
 */
export const criarEtiquetaAdminSchema = z.object({
  remetente: enderecoSchema,
  destinatario: enderecoSchema,
  produtos: z.array(produtoSchema).min(1, 'Informe ao menos um produto'),
  pesoG: z.number().int().positive('Peso deve ser um inteiro positivo em gramas'),
  alturaCm: z.number().positive('Altura deve ser positiva'),
  larguraCm: z.number().positive('Largura deve ser positiva'),
  comprimentoCm: z.number().positive('Comprimento deve ser positivo'),
  formato: z.enum(['CAIXA', 'ROLO', 'ENVELOPE']),
  servicoId: z.string().trim().min(1).optional(),
  cobrarSaldo: z.boolean(),
  motivo: motivoSchema,
})

export type CriarEtiquetaAdminEntrada = z.infer<typeof criarEtiquetaAdminSchema>

export const acaoEtiquetaAdminSchema = z.object({
  acao: z.enum(['CANCELAR', 'EXCLUIR'], {
    errorMap: () => ({ message: 'Ação inválida.' }),
  }),
  motivo: motivoSchema,
})

export type AcaoEtiquetaAdminEntrada = z.infer<typeof acaoEtiquetaAdminSchema>
