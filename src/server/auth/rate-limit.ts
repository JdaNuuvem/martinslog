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

function consumirChave(chaveCompleta: string): boolean {
  const agora = Date.now()
  const atual = registros.get(chaveCompleta)

  if (!atual || atual.expiraEm <= agora) {
    registros.set(chaveCompleta, { contagem: 1, expiraEm: agora + JANELA_MS })
    return true
  }

  if (atual.contagem >= LIMITE_TENTATIVAS) {
    return false
  }

  atual.contagem += 1
  return true
}

/**
 * Registra uma tentativa para o par (escopo, IP) e (escopo, e-mail).
 * Devolve `false` se qualquer um dos dois já atingiu o limite — ou seja, a
 * tentativa é bloqueada tanto por excesso vindo do mesmo IP quanto por
 * excesso mirando o mesmo e-mail.
 */
export function registrarTentativa(escopo: string, ip: string, email: string): boolean {
  const permitidoPorIp = consumirChave(chave(`${escopo}:ip`, ip))
  const permitidoPorEmail = consumirChave(chave(`${escopo}:email`, email))
  return permitidoPorIp && permitidoPorEmail
}

/** Apenas para testes: limpa todos os contadores. */
export function limparRateLimit(): void {
  registros.clear()
}
