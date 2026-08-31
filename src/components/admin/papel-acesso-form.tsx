'use client'

import { useEffect, useId, useState } from 'react'

type ContextoAcesso = {
  papel: 'ADMIN' | 'CLIENTE'
  emailVerificadoEm: string | null
  sessoesAtivas: number
  ehProprio: boolean
  ultimoAdmin: boolean
}

function dataHora(valor: string): string {
  return new Date(valor).toLocaleString('pt-BR')
}

/**
 * Papel e acesso da conta: promover/rebaixar entre `CLIENTE` e `ADMIN`,
 * encerrar todas as sessões e marcar o e-mail como verificado.
 *
 * Este cartão busca o próprio contexto (`GET .../acesso`) em vez de receber
 * tudo por prop — a página que o hospeda pertence a outra sessão de
 * trabalho, e este é o dado que ela não carrega: se o alvo é o próprio ator
 * e se é o último administrador. As duas informações desenham a interface
 * (desabilitam o botão de rebaixar), mas a proteção de verdade é sempre do
 * servidor em `alterarPapel` — um botão desabilitado aqui não é a defesa,
 * é só evitar que alguém clique numa ação que o servidor vai recusar de
 * qualquer forma.
 *
 * Promover a ADMIN é a ação mais sensível deste painel inteiro: dá acesso
 * ao painel inteiro à conta escolhida. O texto do botão e a confirmação
 * dizem isso.
 */
export function PapelAcessoForm({ userId }: { userId: string }) {
  const [contexto, setContexto] = useState<ContextoAcesso | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const idErro = useId()

  async function carregar() {
    setCarregando(true)
    try {
      const resposta = await fetch(`/api/admin/usuarios/${userId}/acesso`)
      if (!resposta.ok) {
        setErro('Não foi possível carregar o papel e acesso desta conta.')
        return
      }
      setContexto((await resposta.json()) as ContextoAcesso)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function chamar(caminho: string, confirmacao?: string) {
    if (confirmacao && !window.confirm(confirmacao)) {
      return
    }

    setErro(null)
    setSucesso(null)
    setOcupado(true)
    try {
      const resposta = await fetch(`/api/admin/usuarios/${userId}${caminho}`, { method: 'POST' })
      const dados = (await resposta.json().catch(() => ({}))) as { mensagem?: string }

      if (!resposta.ok) {
        setErro(dados.mensagem ?? 'Não foi possível concluir a ação.')
        return
      }

      setSucesso('Ação concluída.')
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setOcupado(false)
    }
  }

  async function alterarPapel(novoPapel: 'ADMIN' | 'CLIENTE') {
    const confirmacao =
      novoPapel === 'ADMIN'
        ? 'Promover esta conta a administrador dá acesso ao painel administrativo inteiro, incluindo saldo e dados de todos os clientes. Confirma?'
        : 'Rebaixar esta conta remove o acesso ao painel administrativo. Confirma?'

    if (!window.confirm(confirmacao)) {
      return
    }

    setErro(null)
    setSucesso(null)
    setOcupado(true)
    try {
      const resposta = await fetch(`/api/admin/usuarios/${userId}/papel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ papel: novoPapel }),
      })
      const dados = (await resposta.json().catch(() => ({}))) as { mensagem?: string }

      if (!resposta.ok) {
        setErro(dados.mensagem ?? 'Não foi possível alterar o papel.')
        return
      }

      setSucesso(novoPapel === 'ADMIN' ? 'Conta promovida a administrador.' : 'Conta rebaixada a cliente.')
      await carregar()
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">Papel e acesso</h2>
        <p className="text-sm text-texto-secundario">
          Promover a administrador dá acesso ao painel inteiro. Toda ação aqui fica registrada na
          auditoria.
        </p>
      </div>

      {carregando ? (
        <p className="text-sm text-texto-secundario">Carregando…</p>
      ) : !contexto ? (
        <p role="alert" className="text-sm text-erro">
          {erro ?? 'Não foi possível carregar este cartão.'}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase text-texto-secundario">Papel atual</dt>
              <dd className="text-texto-principal">
                {contexto.papel === 'ADMIN' ? 'Administrador' : 'Cliente'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-texto-secundario">E-mail</dt>
              <dd className="text-texto-principal">
                {contexto.emailVerificadoEm
                  ? `Verificado em ${dataHora(contexto.emailVerificadoEm)}`
                  : 'Não verificado'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-texto-secundario">Sessões ativas</dt>
              <dd className="text-texto-principal">{contexto.sessoesAtivas}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-3">
            {contexto.papel === 'CLIENTE' ? (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void alterarPapel('ADMIN')}
                className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand-texto disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Promover a administrador
              </button>
            ) : (
              <button
                type="button"
                disabled={ocupado || contexto.ehProprio || contexto.ultimoAdmin}
                title={
                  contexto.ehProprio
                    ? 'Você não pode rebaixar a própria conta.'
                    : contexto.ultimoAdmin
                      ? 'Este é o último administrador ativo.'
                      : undefined
                }
                aria-describedby={contexto.ehProprio || contexto.ultimoAdmin ? idErro : undefined}
                onClick={() => void alterarPapel('CLIENTE')}
                className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Rebaixar a cliente
              </button>
            )}

            <button
              type="button"
              disabled={ocupado || contexto.sessoesAtivas === 0}
              onClick={() =>
                void chamar(
                  '/sessoes',
                  'Encerrar todas as sessões desconecta esta conta de todos os dispositivos agora. Confirma?',
                )
              }
              className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              Encerrar todas as sessões
            </button>

            {!contexto.emailVerificadoEm ? (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void chamar('/email-verificado')}
                className="rounded-lg border border-borda-campo px-4 py-2 text-sm font-medium text-texto-principal disabled:opacity-60 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Marcar e-mail como verificado
              </button>
            ) : null}
          </div>

          {(contexto.ehProprio || contexto.ultimoAdmin) && contexto.papel === 'ADMIN' ? (
            <p id={idErro} className="text-xs text-texto-secundario">
              {contexto.ehProprio
                ? 'Você não pode rebaixar a própria conta — peça a outro administrador.'
                : 'Este é o último administrador ativo: promova outra conta antes de rebaixar esta.'}
            </p>
          ) : null}
        </>
      )}

      {erro ? (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      ) : null}
      {sucesso ? (
        <p role="status" className="text-sm text-texto-principal">
          {sucesso}
        </p>
      ) : null}
    </section>
  )
}
