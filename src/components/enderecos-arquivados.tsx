'use client'

import { useCallback, useEffect, useState } from 'react'
import type { EnderecoResposta } from '@/lib/endereco-schema'

type Props = {
  /** Muda sempre que um endereço é arquivado, para recarregar a lista. */
  versao: number
  onReativado: (endereco: EnderecoResposta) => void
}

function resumo(endereco: EnderecoResposta): string {
  const complemento = endereco.complemento ? `, ${endereco.complemento}` : ''
  return `${endereco.logradouro}, ${endereco.numero}${complemento} — ${endereco.bairro}, ${endereco.cidade}/${endereco.uf}`
}

/**
 * Endereços arquivados, com ação de reativar.
 *
 * Existe porque arquivar era um caminho sem volta pela interface: a exclusão
 * sempre foi lógica no banco, mas sem esta tela o endereço sumia para
 * sempre aos olhos do usuário. Fica recolhida por padrão — é uma tela de
 * recuperação, não parte do fluxo do dia a dia.
 */
export function EnderecosArquivados({ versao, onReativado }: Props) {
  const [aberta, setAberta] = useState(false)
  const [enderecos, setEnderecos] = useState<EnderecoResposta[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [reativandoId, setReativandoId] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const resposta = await fetch('/api/enderecos/arquivados')
      if (!resposta.ok) {
        setErro('Não foi possível carregar os endereços arquivados.')
        return
      }
      const corpo = (await resposta.json()) as { enderecos: EnderecoResposta[] }
      setEnderecos(corpo.enderecos)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  // Só busca quando a seção está aberta: quem nunca arquivou nada não paga
  // uma requisição a cada visita à página de endereços.
  useEffect(() => {
    if (!aberta) return
    void carregar()
  }, [aberta, versao, carregar])

  async function reativar(id: string) {
    setErro(null)
    setReativandoId(id)
    try {
      const resposta = await fetch(`/api/enderecos/${id}/reativar`, { method: 'POST' })
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
        setErro(corpo.mensagem ?? 'Não foi possível reativar o endereço.')
        return
      }
      const corpo = (await resposta.json()) as { endereco: EnderecoResposta }
      setEnderecos((atual) => atual.filter((e) => e.id !== id))
      onReativado(corpo.endereco)
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.')
    } finally {
      setReativandoId(null)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-superficie-card p-6">
      <button
        type="button"
        onClick={() => setAberta((atual) => !atual)}
        aria-expanded={aberta}
        aria-controls="lista-enderecos-arquivados"
        className="flex items-center justify-between text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className="text-subtitulo font-semibold text-texto-principal">Endereços arquivados</span>
        <span className="text-sm font-medium text-brand-texto">
          {aberta ? 'Ocultar' : 'Mostrar'}
        </span>
      </button>

      <div id="lista-enderecos-arquivados" hidden={!aberta} className="flex flex-col gap-3">
        <p className="text-sm text-texto-secundario">
          Endereços arquivados voltam como não-padrão. Se quiser um deles como padrão de novo,
          marque-o depois de reativar.
        </p>

        {erro ? (
          <p role="alert" className="text-sm text-erro">
            {erro}
          </p>
        ) : null}

        {carregando ? <p className="text-sm text-texto-secundario">Carregando…</p> : null}

        {!carregando && enderecos.length === 0 ? (
          <p className="text-sm text-texto-secundario">Nenhum endereço arquivado.</p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {enderecos.map((endereco) => (
            <li
              key={endereco.id}
              className="flex flex-col gap-2 rounded-lg border border-borda-campo bg-superficie-bloco p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-texto-principal">
                  {endereco.apelido || endereco.nome || 'Endereço sem apelido'}
                  <span className="ml-2 text-xs font-medium text-texto-secundario">
                    {endereco.tipo === 'REMETENTE' ? 'Remetente' : 'Destinatário'}
                  </span>
                </p>
                <p className="text-sm text-texto-secundario">{resumo(endereco)}</p>
              </div>
              <button
                type="button"
                disabled={reativandoId === endereco.id}
                onClick={() => reativar(endereco.id)}
                className="text-sm font-medium text-brand-texto hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
              >
                {reativandoId === endereco.id ? 'Reativando…' : 'Reativar'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
