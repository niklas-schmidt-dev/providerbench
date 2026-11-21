package ai

import (
	"fmt"
)

var chinese = language{
	code:   "zh",
	name:   "Chinese",
	number: chineseNumber,
	marker: "答案",
	instruction: "请一步一步解答这道题，并在最后单独用一行严格按下面的格式给出答案：\n" +
		"答案：<你的答案>",
	hints: [hintCount]string{
		hintNumber:  "答案请用阿拉伯数字表示。",
		hintPerson:  "只写名字。",
		hintCity:    "只写城市的名字。",
		hintColour:  "只写颜色。",
		hintWeekday: "只写星期几。",
	},
	people: [peopleCount]string{
		"安娜", "鲍里斯", "克拉拉", "大卫", "埃琳娜", "菲利克斯", "格蕾塔", "雨果", "伊雷妮", "约纳斯",
		"卡琳", "莱奥", "玛尔塔", "诺拉", "奥斯卡", "保拉", "罗伯特", "索菲亚", "托马斯", "薇拉",
	},
	cities: [cityCount]string{
		"巴黎", "柏林", "罗马", "维也纳", "布拉格", "里斯本", "雅典", "华沙", "都柏林",
		"奥斯陆", "马德里", "赫尔辛基", "斯德哥尔摩", "布达佩斯", "布鲁塞尔", "哥本哈根", "阿姆斯特丹", "苏黎世",
	},
	colours: [colourCount]string{
		"红色", "蓝色", "绿色", "黄色", "黑色", "白色", "橙色", "紫色", "棕色", "灰色", "粉色",
	},
	colourAliases: [colourCount][]string{6: {"橘色", "橙黄色"}, 8: {"褐色", "咖啡色"}, 10: {"粉红色", "粉红"}},
	weekdays:      [7]string{"星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"},
	weekdayAliases: [7][]string{
		{"周一", "礼拜一"}, {"周二", "礼拜二"}, {"周三", "礼拜三"}, {"周四", "礼拜四"},
		{"周五", "礼拜五"}, {"周六", "礼拜六"}, {"星期天", "周日", "礼拜天", "礼拜日"},
	},

	arithmetic: arithmeticText{
		start: func(north, south string) string {
			return fmt.Sprintf("北仓库有%s个箱子，南仓库有%s个箱子。", north, south)
		},
		receive: func(w int, n string) string {
			return fmt.Sprintf("%s仓库收到一批货，共%s个箱子。", zhSide[w], n)
		},
		ship: func(w int, n string) string {
			return fmt.Sprintf("%s仓库向客户发出%s个箱子。", zhSide[w], n)
		},
		move: func(from int, n string) string {
			return fmt.Sprintf("从%s仓库调%s个箱子到%s仓库。", zhSide[from], n, zhSide[1-from])
		},
		double: func(w int) string {
			return fmt.Sprintf("%s仓库的库存翻了一番。", zhSide[w])
		},
		halve: func(w int) string {
			return fmt.Sprintf("%s仓库里一半的箱子被卖掉了。", zhSide[w])
		},
		askOne: func(w int) string {
			return fmt.Sprintf("最后，%s仓库里有多少个箱子？", zhSide[w])
		},
		askTotal: "最后，两个仓库里一共有多少个箱子？",
		askDiff:  "最后，两个仓库的库存相差多少个箱子？",
	},

	ordering: orderingText{
		intro:   "有几个人在比较年龄，没有任何两个人年龄相同。",
		older:   func(a, b string) string { return a + "比" + b + "年龄大。" },
		younger: func(a, b string) string { return a + "比" + b + "年龄小。" },
		ask: func(position int) string {
			return fmt.Sprintf("所有人按年龄从小到大排成一队，年龄最小的排在第1位。排在第%d位的是谁？", position)
		},
	},

	reading: readingText{
		lives:  func(person, city string) string { return person + "住在" + city + "。" },
		likes:  func(person, colour string) string { return person + "最喜欢" + colour + "。" },
		writes: func(person, to string) string { return person + "给" + to + "写信。" },
		walk: func(start string, steps int) string {
			return fmt.Sprintf("从%s开始。每走一步，就从当前的人走到这个人写信的对象那里。步数：%d。", start, steps)
		},
		askCity:   "你最后走到的那个人住在哪个城市？",
		askColour: "你最后走到的那个人最喜欢什么颜色？",
	},

	procedure: procedureText{
		intro: func(list string) string {
			return "这里有一个数字列表：" + list + "。请按顺序执行下面的步骤。"
		},
		separator:       "、",
		removeDivisible: func(n string) string { return "删除所有能被" + n + "整除的数。" },
		reverse:         "把列表的顺序颠倒过来。",
		add:             func(n string) string { return "给每个数加上" + n + "。" },
		swapEnds:        "把第一个数和最后一个数交换位置。",
		sortDescending:  "把列表按从大到小的顺序排列。",
		sortAscending:   "把列表按从小到大的顺序排列。",
		removeLargest:   "删除最大的数。",
		removeSmallest:  "删除最小的数。",
		removeGreater:   func(n string) string { return "删除所有大于" + n + "的数。" },
		multiply:        func(n string) string { return "把每个数乘以" + n + "。" },
		askFirst:        "现在列表中的第一个数是多少？",
		askLast:         "现在列表中的最后一个数是多少？",
		askSum:          "现在列表中所有数的和是多少？",
		askCount:        "现在列表中有多少个数？",
	},

	calendar: calendarText{
		date: func(month, day int) string { return fmt.Sprintf("%d月%d日", month, day) },
		ask: func(known, weekday, target string) string {
			return fmt.Sprintf("在某一年，%s是%s。同一年的%s是星期几？", known, weekday, target)
		},
	},
}

var zhSide = [2]string{"北", "南"}

var zhDigits = [10]string{"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"}

// chineseNumber follows the textbook reading: ten is 十 on its own but 一十
// after a hundred, and a skipped tens place is read as 零.
func chineseNumber(n int) string {
	checkNumber(n)
	if n < 10 {
		return zhDigits[n]
	}
	hundreds, tens, ones := n/100, n/10%10, n%10
	words := ""
	if hundreds > 0 {
		words = zhDigits[hundreds] + "百"
	}
	switch {
	case tens > 1 || tens == 1 && hundreds > 0:
		words += zhDigits[tens] + "十"
	case tens == 1:
		words += "十"
	case ones > 0: // tens is zero inside a number above one hundred
		words += "零"
	}
	if ones > 0 {
		words += zhDigits[ones]
	}
	return words
}
