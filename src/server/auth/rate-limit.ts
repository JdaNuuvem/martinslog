/**
 * Rate limiting em memória de processo para login, cadastro e recuperação
 * de senha: 5 tentativas por 15 minutos, por IP e por e-mail. Simples e
 * suficiente para uma instância única; se a aplicação passar a rodar em
 * múltiplas instâncias, isto precisa migrar para um armazenamento
 * compartilhado (ex.: Redis).
 */

const JANELA_MS = 15 * 60 * 1000
const LIMITE_TENTATIVAS = 5

type Registro = { contagem: number; expiraEm: number }

const registros = new Map<string, Registro>()

function chave(escopo: string, identificador: string): string {
  return `${escopo}:${identificador.toLowerCase()}`
}

function limiteAtingido(chaveCompleta: string): boolean {
  const atual = registros.get(chaveCompleta)
  const agora = Date.now()
  return !!atual && atual.expiraEm > agora && atual.contagem >= LIMITE_TENTATIVAS
}

function incrementar(chaveCompleta: string): void {
  const agora = Date.now()
  const atual = registros.get(chaveCompleta)

  if (!atual || atual.expiraEm <= agora) {
    registros.set(chaveCompleta, { contagem: 1, expiraEm: agora + JANELA_MS })
    return
  }

  atual.contagem += 1
}

/**
 * Registra uma tentativa para o par (escopo, IP) e (escopo, e-mail) e
 * devolve `false` se qualquer um dos dois já estava no limite antes desta
 * chamada (ou seja, bloqueia tanto excesso vindo do mesmo IP quanto excesso
 * mirando o mesmo e-mail). Usado por fluxos sem noção de sucesso/falha
 * (ex.: cadastro), onde toda tentativa conta igualmente.
 */
export function registrarTentativa(escopo: string, ip: string, email: string): boolean {
  const chaveIp = chave(`${escopo}:ip`, ip)
  const chaveEmail = chave(`${escopo}:email`, email)

  if (limiteAtingido(chaveIp) || limiteAtingido(chaveEmail)) {
    return false
  }

  incrementar(chaveIp)
  incrementar(chaveEmail)
  return true
}

/**
 * Verifica se o par (escopo, IP)/(escopo, e-mail) já está no limite, sem
 * consumir cota. Use antes de uma operação cujo custo de cota deve ser
 * pago apenas em caso de falha (ex.: login).
 */
export function limiteExcedido(escopo: string, ip: string, email: string): boolean {
  return limiteAtingido(chave(`${escopo}:ip`, ip)) || limiteAtingido(chave(`${escopo}:email`, email))
}

/**
 * Consome uma unidade de cota para o IP e o e-mail. Use somente após uma
 * tentativa malsucedida (ex.: senha errada, e-mail inexistente) — sucesso
 * não deve consumir cota.
 */
export function registrarFalha(escopo: string, ip: string, email: string): void {
  incrementar(chave(`${escopo}:ip`, ip))
  incrementar(chave(`${escopo}:email`, email))
}

/**
 * Zera o contador de e-mail do escopo informado. Use após uma autenticação
 * bem-sucedida, para que tentativas malsucedidas anteriores não continuem
 * bloqueando o próximo login legítimo da mesma pessoa.
 */
export function limparPorEmail(escopo: string, email: string): void {
  registros.delete(chave(`${escopo}:email`, email))
}

/** Apenas para testes: limpa todos os contadores. */
export function limparRateLimit(): void {
  registros.clear()
}
