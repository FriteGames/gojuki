import * as _ from 'lodash'
import {
    PlayerInput,
    World,
    getDefaultPlayer,
    stepPlayer,
    stepWorld,
    powerups,
    getDefaultGame,
} from './game'
let serverTick = 0

/* Messages & message creators */
export type LIST_PARTIES_MESSAGE = { type: 'LIST_PARTIES' }
export type CREATE_PARTY_MESSAGE = { type: 'CREATE_PARTY'; name: string }
export type SET_PARTY_MESSAGE = { type: 'SET_PARTY'; id: string }
export type JOIN_PARTY_MESSAGE = {
    type: 'JOIN_PARTY'
    partyId: string
    playerName: string
    test?: boolean
}
export type START_GAME_MESSAGE = { type: 'START_GAME'; partyId: string }

export type PLAYER_INPUTS = { type: 'CLIENT_INPUTS'; input: PlayerInput }
export type PLAYER_UPGRADE_MESSAGE = {
    type: 'PLAYER_UPGRADES'
    powerup: Powerup
    delta: 1 | -1
}
export type SERVER_TICK_MESSAGE = {
    type: 'SERVER_TICK'
    party: null | PartyState
    serverTick: number
    clientTick: number
    delay: number
}

export type CLIENT_TICK_MESSAGE = {
    type: 'CLIENT_TICK'
    inputs: Array<[number, PlayerInput]>
    serverTick: number
    clientTick: number
}

export type Message =
    | LIST_PARTIES_MESSAGE
    | CREATE_PARTY_MESSAGE
    | JOIN_PARTY_MESSAGE
    | SET_PARTY_MESSAGE
    | PLAYER_INPUTS
    | SERVER_TICK_MESSAGE
    | PLAYER_UPGRADE_MESSAGE
    | CLIENT_TICK_MESSAGE
    | START_GAME_MESSAGE
    | SET_PARTY_MESSAGE

export type Powerup = 'Sticky Goo' | 'Speed' | 'Food Carry Limit'
export function selectUpgrade(powerup: Powerup, delta: 1 | -1): PLAYER_UPGRADE_MESSAGE {
    return {
        type: 'PLAYER_UPGRADES',
        powerup,
        delta,
    }
}

/* State Types*/
export type stateT = {
    parties: { [id: string]: PartyState }
    clientTicks: {
        [id: string]: { clientTick: number; ackedServerTick: number; capturedAt: number }
    }
}

export type PartyStatus = 'NOT_STARTED' | 'LOBBY' | 'PLAYING' | 'FINISHED' | 'UPGRADES' | 'TEST'
export type PartyListing = {
    id: string
    name: string
    players: Array<Player>
    status: PartyStatus
}

export type PartyState = {
    id: string
    name: string
    players: Array<Player>
    status: PartyStatus
    game: World | undefined
}

export type Player = {
    playerName: string
    peerId: string
}

/* State Handlers */

let state: stateT = {
    parties: {},
    clientTicks: {},
}

let partyIndex: any = {}
let nextParty = 1
export function initTicks(peerId: string) {
    state.clientTicks[peerId] = {
        ackedServerTick: -1,
        clientTick: -1,
        capturedAt: -1,
    }
}

export function handleMessage(message: Message, peerId: string) {
    if (message.type === 'JOIN_PARTY') {
        return handleJoinParty(message, peerId)
    } else if (message.type === 'PLAYER_UPGRADES') {
        return handlePlayerUpgrades(message, peerId)
    } else if (message.type === 'CLIENT_TICK') {
        return handleClientTick(message, peerId)
    } else if (message.type === 'START_GAME') {
        return handleStartGame(message)
    } else if (message.type === 'LIST_PARTIES') {
        return handleListParties(message, peerId)
    } else if (message.type === 'CREATE_PARTY') {
        return handleCreateParty(message, peerId)
    } else if (message.type === 'SET_PARTY') {
        return handleSetParty(message, peerId)
    }
}

export function handleListParties(
    message: LIST_PARTIES_MESSAGE,
    peerId: string,
): Array<PartyListing> {
    const isInParty = (party: PartyState) => !!party.players.find((p) => p.peerId === peerId)
    const parties = Object.values(state.parties).filter(
        (p) => p.status === 'LOBBY' || (p.status !== 'FINISHED' && isInParty(p)),
    )
    const listings = parties.map((party) => ({
        name: party.name,
        players: party.players,
        id: party.id,
        status: party.status,
    }))
    return listings
}

export function handleCreateParty(message: CREATE_PARTY_MESSAGE, peerId: string): PartyState {
    let id = nextParty++
    state.parties[id] = {
        id: String(id),
        name: message.name,
        status: 'LOBBY',
        players: [],
        game: null,
    }
    return state.parties[id]
}

export function handleSetParty(message: SET_PARTY_MESSAGE, peerId: string): {} {
    partyIndex[peerId] = message.id
    return {}
}

export function handleJoinParty(
    message: JOIN_PARTY_MESSAGE,
    peerId: string,
): { partyId: string } | { err: string } {
    const partyId = message.partyId
    const party = state.parties[partyId]
    if (party && party.players.length >= 4) {
        return { err: 'Sorry, this party is full' }
    }
    if (party.players.some((p) => p.peerId === peerId)) {
        return { err: 'You are already in the party, doofus' }
    }

    party.players.push({ peerId, playerName: message.playerName })
    partyIndex[peerId] = partyId

    if (message.test) {
        const startGameMessage: START_GAME_MESSAGE = { type: 'START_GAME', partyId }
        handleStartGame(startGameMessage)
        state.parties[partyId].status = 'TEST'
    }

    return { partyId }
}

export function handleStartGame(message: START_GAME_MESSAGE) {
    const party = state.parties[message.partyId]
    if (party.players.length > 4) {
        console.error(`Should never be more than 4 player, but there were: ${party.players.length}`)
        return
    }
    if (party.status !== 'LOBBY') {
        console.error(
            `Can only start a game that has not already been started. PartyId: ${message.partyId}`,
        )
        return
    }

    party.status = 'PLAYING'
    party.game = getDefaultGame(party.players)

    // HACK TO START AT UPGRADES
    const upgradesHack = false
    if (upgradesHack) {
        party.status = 'UPGRADES'
        party.game.players[party.players[0].peerId].food = 18
    }
}

function handleClientTick(message: CLIENT_TICK_MESSAGE, peerId: string) {
    if (message.clientTick <= state.clientTicks[peerId].clientTick) {
        // console.log(
        //     `dupe or outdated message because of outdated clientTick: ${message.clientTick}`,
        // )
    }

    if (!getPartyId(peerId)) {
        console.log(`SHOULD NOT BE RECEIVING CLIENT_TICK BEFORE GAME START`)
        return
    }

    const prevClientTick = state.clientTicks[peerId].clientTick
    state.clientTicks[peerId] = {
        clientTick: message.clientTick,
        ackedServerTick: message.serverTick,
        capturedAt: Date.now(),
    }

    let inputs: Array<PlayerInput> = message.inputs
        .filter((elem) => elem[0] > prevClientTick)
        .map((elem) => elem[1])

    // This is awful anti-cheat logic. Right now clients can make 4 moves every move.
    // TODO: use bursty api logic. hold a counter from 0 that increments up by one every 16ms w/ a low max. that num represents how many moves a client can make.
    // if (inputs.length > 5) {
    //     console.log('removing inputs for anti-cheat logic')
    //     inputs = _.takeRight(inputs, 5)
    // }

    const party = state.parties[getPartyId(peerId)]
    if (party.status === 'PLAYING' || party.status === 'TEST') {
        stepPlayer(party.game, peerId, inputs)
    }
}

export function handlePlayerUpgrades(message: PLAYER_UPGRADE_MESSAGE, peerId: string) {
    const partyId = getPartyId(peerId)
    const player = state.parties[partyId].game.players[peerId]
    const { cost, shortName } = powerups[message.powerup]

    if (player.food >= cost && message.delta === 1) {
        player.food -= cost
        player.powerups[shortName]++
    } else if (message.delta === -1 && player.powerups[shortName] > 0) {
        player.food += cost
        player.powerups[shortName]--
    }
    return player.powerups
}

/**
 *  Client/Server sync strategy.
 *
 * **Ticks**
 * Tick is a concept for both the client and the server. A tick refers to a state update. Every single time the state updates, the tick number is increased by one.
 * Therefore if the tick rate is 60hz (once every 16ms), every second will increase the tick number by 60.
 *
 * The client and server should independently have a monotonically increasing tick.
 * - A client needs to keep track of its own tick, the server's tick, and the latest ACKed `clientTick` that the server recieved.
 * - A server can maintain a single `serverTick` that is reused for all of its clients, but must maintain a unique `clientTick` and `ackedServerTick` for each client.
 *
 * The *acked* tick tells the server/client what still needs to be sent aka everything that hasn't been ACKed.
 */

function getPartyId(peerId: string) {
    return partyIndex[peerId]
}

function tick() {
    serverTick++
}
export function stepWorlds() {
    tick()
    for (const party of Object.values(state.parties)) {
        stepWorld(party, serverTick)
    }
}

export function getTickData(peerId: string): SERVER_TICK_MESSAGE {
    return {
        type: 'SERVER_TICK',
        serverTick,
        clientTick: state.clientTicks[peerId].clientTick,
        delay: Date.now() - state.clientTicks[peerId].capturedAt,
        party: state.parties[getPartyId(peerId)],
    }
}
