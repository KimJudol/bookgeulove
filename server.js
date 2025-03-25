const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const missionData = {};
const depositData = {}; // 보증금 데이터를 저장하는 객체 추가
const channels = {
    dailyLog: '1348474258346606662',
    weeklyReview: '1348474325249818625'
};

const heyeunId = '1089830726251315301'; // 혜은의 유저 ID

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const userId = message.author.id;
    const channelId = message.channel.id;
    const now = new Date();
    now.setHours(now.getHours() - 8); // 전날 08:00부터 오늘 08:00까지 체크
    const today = now.toISOString().split('T')[0];

    if (!missionData[userId]) {
        missionData[userId] = {};
    }
    if (!missionData[userId][today]) {
        missionData[userId][today] = { daily: false, weekly: new Set(), review: false };
    }

    if (!depositData[userId]) {
        depositData[userId] = 50000; // 기본 보증금 50,000원
    }

    if (channelId === channels.dailyLog) {
        missionData[userId][today].daily = true;
    } else if (message.type === 19 && message.channel.isThread()) { // 스레드 메시지인지 확인
        const threadOriginalAuthor = (await message.channel.fetchStarterMessage())?.author.id;

        if (threadOriginalAuthor !== userId) { // 원글 작성자와 댓글 작성자가 다를 때만 인정
            missionData[userId][today].weekly.add(message.channel.id); // 다른 스레드에 남긴 경우만 추가
        }
    } else if (channelId === channels.weeklyReview) {
        missionData[userId][today].review = true;
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options, user } = interaction;

    if (commandName === 'setdeposit') {
        if (user.id !== heyeunId) {
            return interaction.reply({ content: '⛔ 이 명령어는 혜은님만 사용할 수 있습니다!', ephemeral: true });
        }

        const targetUser = options.getUser('user');
        const amount = options.getInteger('amount');

        if (!targetUser || !amount || amount < 0) {
            return interaction.reply({ content: '올바른 유저와 금액을 입력하세요! (0원 이상 가능)', ephemeral: true });
        }

        depositData[targetUser.id] = amount;

        interaction.reply({ content: `💰 ${targetUser.username}님의 보증금이 ${amount.toLocaleString()}원으로 설정되었습니다!`, ephemeral: true });
    } else if (commandName === 'endmonth') {
        if (user.id !== heyeunId) {
            return interaction.reply({ content: '⛔ 이 명령어는 혜은님만 사용할 수 있습니다!', ephemeral: true });
        }

        const resetAmount = options.getInteger('amount');
        if (resetAmount === null || resetAmount < 0) {
            return interaction.reply({ content: '올바른 보증금 금액을 입력하세요! (0원 이상 가능)', ephemeral: true });
        }

        for (const userId in depositData) {
            depositData[userId] = resetAmount;
        }

        interaction.reply({ content: `📅 이번 달 보증금이 ${resetAmount.toLocaleString()}원으로 초기화되었습니다!`, ephemeral: false });
    }
});

cron.schedule('1 8 * * 0', async () => {
    let report = '📊 주간 활동 보고서\n';
    const reviewChannel = client.channels.cache.get(channels.weeklyReview);
    const members = reviewChannel.members.map(member => member.id);

    for (const userId of members) {
        let dailyCount = 0;
        let weeklyThreads = 0;
        let reviewCount = 0;

        if (missionData[userId]) {
            for (const day in missionData[userId]) {
                if (missionData[userId][day].daily) dailyCount++;
                if (missionData[userId][day].weekly.size >= 2) weeklyThreads = 2;
                if (missionData[userId][day].review) reviewCount = 1;
            }
        }

        let penalty = 0;
        if (dailyCount < 5) {
            penalty += 3000; // 매일 기록 미달 시 3,000원 차감
        }
        if (weeklyThreads === 1) {
            penalty += 1000; // 스레드 댓글이 1개일 경우 1,000원 차감
        } else if (weeklyThreads === 0) {
            penalty += 2000; // 스레드 댓글이 0개일 경우 2,000원 차감
        }
        if (reviewCount < 1) {
            penalty += 3000; // 독서 리뷰 미참여 시 3,000원 차감
        }

        depositData[userId] = Math.max(0, depositData[userId] - penalty); // 보증금은 최소 0원 유지

        report += `<@${userId}>: 매일 기록: ${dailyCount}/5, 📝 스레드 댓글: ${weeklyThreads}/2, 📖 리뷰 참여: ${reviewCount}/1\n`;

        // 개별 멤버에게 DM 전송
        if (userId !== heyeunId) {
            const user = await client.users.fetch(userId);
            if (user) {
                const deposit = depositData[userId].toLocaleString();
                const personalReport = `📊 북글럽 N주차 주간활동 보고서입니다.\n\n` +
                    `${user.globalName || user.username}님의 이번 주 현황입니다.\n` +
                    `✍️ 매일 기록: ${dailyCount}/5\n` +
                    `💬 스레드 댓글: ${weeklyThreads}/2\n` +
                    `📖 독서 리뷰: ${reviewCount}/1\n` +
                    `💵 남은 보증금: ${deposit}원\n\n` +
                    `이번 주도 수고하셨습니다 :-)`;

                user.send(personalReport).catch(console.error);
            }
        }
    }

    // 혜은에게 전체 보고서 전송
    const heyeun = await client.users.fetch(heyeunId);
    if (heyeun) {
        heyeun.send(report).catch(console.error);
    }
});

const commands = [
    {
        name: 'setdeposit',
        description: '특정 멤버의 보증금을 설정합니다.',
        options: [
            {
                name: 'user',
                type: 6, // USER 타입
                description: '보증금을 설정할 유저',
                required: true
            },
            {
                name: 'amount',
                type: 4, // INTEGER 타입
                description: '설정할 보증금 (숫자)',
                required: true
            }
        ]
    },
    {
        name: 'endmonth',
        description: '이번 달 보증금을 초기화합니다.',
        options: [
            {
                name: 'amount',
                type: 4, // INTEGER 타입
                description: '초기화할 보증금 금액',
                required: true
            }
        ]
    }
];

client.login(process.env.DISCORD_TOKEN);