'use client'

import { useEffect, useState } from 'react'
import { EnderecoForm } from '@/components/endereco-form'
import type { EnderecoResposta } from '@/lib/endereco-schema'
import { classeBotaoSecundario } from './wizard-ui'

/**
 * Converte um `EnderecoResposta` salvo (`/api/enderecos`) no formato que
 * `POST /api/envios` espera para `remetente`/`destinatario`. É aqui — e só
 * aqui — que os dois formatos se encontram; o restante do wizard trabalha
 * com `EnderecoResposta`.
 */
export function enderecoParaEnvio(endereco: EnderecoResposta) {
  return {
    nome: endereco.nome ?? '',
    documento: endereco.documento ?? undefined,
    email: endereco.email ?? undefined,
    telefone: endereco.telefone ?? undefined,
    cep: endereco.cep,
    logradouro: endereco.logradouro,
    numero: endereco.numero,
    complemento: endereco.complemento ?? undefined,
    bairro: endereco.bairro,
    cidade: endereco.cidade,
    uf: endereco.uf,
  }
}

type SeletorEnderecoProps = {
  tipo: 'REMETENTE' | 'DESTINATARIO'
  titulo: string
  selecionado: EnderecoResposta | null
  onSelecionar: (endereco: EnderecoResposta) => void
}

/**
 * Lista os endereços salvos do usuário (filtrados por `tipo`) para escolha,
 * com opção de cadastrar um novo — reaproveitando `EnderecoForm`, que já
 * persiste em `/api/enderecos` e segue o padrão de acessibilidade das
 * telas anteriores.
 */
export function SeletorEndereco({ tipo, titulo, selecionado, onSelecionar }: SeletorEnderecoProps) {
  const [enderecos, setEnderecos] = useState<EnderecoResposta[] | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const resposta = await fetch('/api/enderecos')
      if (!resposta.ok) {
        setErro('Não foi possível carregar os endereços salvos.')
        return
      }
      const dados = (await resposta.json()) as { enderecos: EnderecoResposta[] }
      setEnderecos(dados.enderecos.filter((e) => e.tipo === tipo))
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo])

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold text-texto-principal">{titulo}</legend>

      {carregando && <p className="text-sm text-texto-secundario">Carregando endereços…</p>}
      {erro && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}

      {enderecos && enderecos.length > 0 && (
        <div className="flex flex-col gap-2">
          {enderecos.map((endereco) => (
            <label
              key={endereco.id}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-brand ${
                selecionado?.id === endereco.id
                  ? 'border-brand bg-brand-bg'
                  : 'border-borda-campo bg-superficie-card hover:bg-superficie-bloco'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`endereco-${tipo}`}
                  checked={selecionado?.id === endereco.id}
                  onChange={() => onSelecionar(endereco)}
                />
                <span className="font-semibold text-texto-principal">
                  {endereco.apelido || endereco.nome || 'Endereço sem apelido'}
                </span>
              </span>
              <span className="pl-6 text-texto-secundario">
                {endereco.logradouro}, {endereco.numero} — {endereco.bairro}, {endereco.cidade}/{endereco.uf}
              </span>
            </label>
          ))}
        </div>
      )}

      {enderecos && enderecos.length === 0 && !mostrarFormulario && (
        <p className="text-sm text-texto-secundario">Nenhum endereço salvo deste tipo ainda.</p>
      )}

      {!mostrarFormulario ? (
        <button type="button" onClick={() => setMostrarFormulario(true)} className={classeBotaoSecundario}>
          Cadastrar novo endereço
        </button>
      ) : (
        <div className="rounded-lg border border-borda-campo p-4">
          <EnderecoForm
            tipo={tipo}
            onCancelar={() => setMostrarFormulario(false)}
            onSalvar={(endereco) => {
              setMostrarFormulario(false)
              void carregar()
              onSelecionar(endereco)
            }}
          />
        </div>
      )}
    </fieldset>
  )
}
